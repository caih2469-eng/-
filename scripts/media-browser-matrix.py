"""Measure the production browser compressor with real local images.

This helper does not upload files. It opens the test deployment, loads each
local image through a file input, runs the same browser-image-compression
options as the application, and prints machine-readable JSON.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


TEST_URL = os.environ.get("MEDIA_TEST_URL", "https://jinshan20-test.pages.dev/")
TEST_UA = os.environ.get(
    "MEDIA_TEST_UA",
    (
        "Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230805.001; wv) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 "
        "Mobile Safari/537.36 MicroMessenger/8.0.47 WeChat/arm64"
    ),
)
FILES = [Path(value).resolve() for value in sys.argv[1:]]


def image_metrics(driver: webdriver.Chrome) -> dict:
    return driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        (async () => {
          const input = document.querySelector('#codex-media-matrix');
          const file = input && input.files && input.files[0];
          if (!file) throw new Error('No test file selected');

          if (file.size > 5 * 1024 * 1024) {
            done({
              name: file.name,
              sourceBytes: file.size,
              sourceType: file.type,
              rejected: true,
              reason: 'over-5MiB'
            });
            return;
          }

          const sourceBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
          const sourceWidth = sourceBitmap.width;
          const sourceHeight = sourceBitmap.height;
          const started = performance.now();
          const output = await window.imageCompression(file, {
            maxSizeMB: 1.2,
            maxWidthOrHeight: 1600,
            useWebWorker: true,
            fileType: 'image/webp',
            initialQuality: 0.90,
            preserveExif: false,
            libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`
          });
          const compressionMs = performance.now() - started;
          const outputBitmap = await createImageBitmap(output);

          // Compare the decoded result against the source scaled to the same
          // dimensions. Sampling every fourth pixel keeps mobile-class runs
          // responsive while still providing a stable visual-quality signal.
          const width = outputBitmap.width;
          const height = outputBitmap.height;
          const referenceCanvas = document.createElement('canvas');
          const outputCanvas = document.createElement('canvas');
          referenceCanvas.width = outputCanvas.width = width;
          referenceCanvas.height = outputCanvas.height = height;
          const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true });
          const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
          referenceContext.drawImage(sourceBitmap, 0, 0, width, height);
          outputContext.drawImage(outputBitmap, 0, 0, width, height);
          const referencePixels = referenceContext.getImageData(0, 0, width, height).data;
          const outputPixels = outputContext.getImageData(0, 0, width, height).data;
          let squaredError = 0;
          let sampleCount = 0;
          for (let index = 0; index < referencePixels.length; index += 16) {
            for (let channel = 0; channel < 3; channel += 1) {
              const delta = referencePixels[index + channel] - outputPixels[index + channel];
              squaredError += delta * delta;
              sampleCount += 1;
            }
          }
          const mse = squaredError / Math.max(sampleCount, 1);
          const psnr = mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);

          sourceBitmap.close();
          outputBitmap.close();
          URL.revokeObjectURL(URL.createObjectURL(output));
          done({
            name: file.name,
            sourceBytes: file.size,
            sourceType: file.type,
            sourceWidth,
            sourceHeight,
            outputBytes: output.size,
            outputType: output.type,
            outputWidth: width,
            outputHeight: height,
            compressionMs: Math.round(compressionMs),
            ratio: Number((output.size / file.size).toFixed(4)),
            psnrDb: Number(psnr.toFixed(2)),
            rejected: false
          });
        })().catch(error => done({ error: String(error), stack: error && error.stack }));
        """
    )


def main() -> None:
    if not FILES:
        raise SystemExit("Pass one or more image paths.")
    missing = [str(path) for path in FILES if not path.is_file()]
    if missing:
        raise SystemExit(f"Missing files: {missing}")

    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-first-run")
    options.add_argument("--window-size=390,844")
    options.add_experimental_option(
        "mobileEmulation",
        {
            "deviceMetrics": {"width": 390, "height": 844, "pixelRatio": 3},
            "userAgent": TEST_UA,
        },
    )

    driver = webdriver.Chrome(options=options)
    driver.set_script_timeout(120)
    try:
        driver.execute_cdp_cmd(
            "Network.emulateNetworkConditions",
            {
                "offline": False,
                "latency": 80,
                "downloadThroughput": 4_000_000 / 8,
                "uploadThroughput": 1_500_000 / 8,
                "connectionType": "cellular4g",
            },
        )
        driver.execute_cdp_cmd("Emulation.setCPUThrottlingRate", {"rate": 4})
        driver.get(TEST_URL)
        WebDriverWait(driver, 30).until(
            lambda current: current.execute_script("return document.readyState === 'complete'")
        )
        if not driver.execute_script(
            "return typeof window.imageCompression === 'function'"
        ):
            driver.execute_async_script(
                """
                const done = arguments[arguments.length - 1];
                const script = document.createElement('script');
                script.src = '/vendor/browser-image-compression-2.0.2.js';
                script.onload = () => done(true);
                script.onerror = () => done(false);
                document.head.appendChild(script);
                """
            )
        WebDriverWait(driver, 30).until(
            lambda current: current.execute_script(
                "return typeof window.imageCompression === 'function'"
            )
        )
        driver.execute_script(
            """
            const prior = document.querySelector('#codex-media-matrix');
            if (prior) prior.remove();
            const input = document.createElement('input');
            input.type = 'file';
            input.id = 'codex-media-matrix';
            input.accept = 'image/jpeg,image/png,image/webp';
            document.body.appendChild(input);
            """
        )
        file_input = driver.find_element(By.ID, "codex-media-matrix")
        results = []
        for path in FILES:
            file_input.send_keys(str(path))
            measured = image_metrics(driver)
            measured["path"] = str(path)
            results.append(measured)
            driver.execute_script(
                """
                const oldInput = document.querySelector('#codex-media-matrix');
                const nextInput = oldInput.cloneNode();
                oldInput.replaceWith(nextInput);
                """
            )
            file_input = driver.find_element(By.ID, "codex-media-matrix")
        print(
            json.dumps(
                {"url": TEST_URL, "userAgent": TEST_UA, "results": results},
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
