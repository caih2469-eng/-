function memberCheckinForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  const imageLimit = Math.max(1, Math.min(8, Number(task.imageLimit || 1)));
  app.innerHTML = `<header class="hero"><h1>个人打卡</h1><p>${escapeHtml(task.name)}</p></header>
    <section class="card"><form id="memberSend">
      <div class="notice">姓名和学号由账号自动带入，本任务最多上传 ${imageLimit} 张本人当天截图。</div>
      <label>姓名</label><input value="${escapeHtml(user.name)}" readonly>
      <label>学号</label><input value="${escapeHtml(user.studentId)}" readonly>
      <label>校区</label><input value="${escapeHtml(user.campus)}" readonly>
      <label>图片（最多 ${imageLimit} 张）</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" ${imageLimit > 1 ? 'multiple' : ''} required>
      <div class="image-preview" id="memberPreview"></div>
      <p class="muted" id="memberUploadStatus">选择图片后会立即预览，并逐张压缩上传。</p>
      <button type="button" class="secondary" id="retryMemberUpload" hidden>重试失败图片</button>
      <div class="row"><button type="button" class="secondary" id="backMember">返回</button><button>确定打卡</button></div>
    </form></section>`;
  const form = document.querySelector('#memberSend');
  const submitButton = form.querySelector('button:not([type="button"])');
  const retryButton = document.querySelector('#retryMemberUpload');
  const status = document.querySelector('#memberUploadStatus');
  const preview = document.querySelector('#memberPreview');
  let session = null;

  const releaseSession = () => {
    session?.controller?.abort();
    (session?.items || []).forEach((item) => {
      if (!item.previewUrl) return;
      URL.revokeObjectURL(item.previewUrl);
      mediaPreviewUrls.delete(item.previewUrl);
    });
    session = null;
    form._media = null;
  };

  const allReady = () => Boolean(
    session?.items?.length
    && session.items.every((item) => item.mediaId)
    && !session.uploadPromise
  );

  const updateReadyState = () => {
    submitButton.disabled = !allReady();
    submitButton.textContent = session?.uploadPromise ? '图片上传中' : '确定打卡';
    retryButton.hidden = !session?.items?.some((item) => item.error && !item.mediaId)
      || Boolean(session?.uploadPromise);
  };

  const uploadCurrentSession = async (current, onlyFailed = false) => {
    if (!current || current !== session || current.uploadPromise) return current?.items || [];
    const indexes = current.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.mediaId && (!onlyFailed || item.error))
      .map(({ index }) => index);
    if (!indexes.length) return current.items;
    current.items.forEach((item) => { if (!item.mediaId) item.error = null; });
    const uploadPromise = (async () => {
      for (const index of indexes) {
        if (current !== session || current.controller.signal.aborted) return current.items;
        const item = current.items[index];
        const position = `第 ${index + 1}/${current.items.length} 张`;
        try {
          if (!item.compressed) {
            status.textContent = `${position}：正在压缩图片…`;
            item.compressed = await compressMemberCheckinImage(item.sourceFile, {
              signal: current.controller.signal
            });
          }
          status.textContent = `${position}：正在上传图片…`;
          const uploaded = await uploadMemberCheckinFast(
            item.compressed,
            task.id,
            item.idempotencyKey,
            current.controller.signal
          );
          if (current !== session) return current.items;
          item.mediaId = uploaded.mediaId;
          item.error = null;
        } catch (error) {
          if (current.controller.signal.aborted || current !== session) return current.items;
          item.error = error;
        }
      }
      if (current !== session) return current.items;
      const failed = current.items
        .map((item, index) => item.error && !item.mediaId ? index + 1 : null)
        .filter(Boolean);
      if (failed.length) {
        status.textContent = `第 ${failed.join('、')} 张上传失败，请点击重试。`;
      } else {
        form._media = current.items.map((item) => ({ mediaId: item.mediaId }));
        status.textContent = `${current.items.length} 张图片已就绪`;
      }
      return current.items;
    })();
    current.uploadPromise = uploadPromise;
    updateReadyState();
    try {
      return await uploadPromise;
    } finally {
      if (current === session) {
        current.uploadPromise = null;
        updateReadyState();
      }
    }
  };

  document.querySelector('#backMember').onclick = () => {
    releaseSession();
    home();
  };
  retryButton.onclick = () => {
    if (session && !session.uploadPromise) void uploadCurrentSession(session, true);
  };

  form.images.onchange = async () => {
    const previewStartedAt = performance.now();
    releaseSession();
    submitButton.disabled = true;
    retryButton.hidden = true;
    preview.innerHTML = '';
    const files = [...(form.images.files || [])];
    if (!files.length) {
      status.textContent = '请选择图片。';
      return;
    }
    if (files.length > imageLimit) {
      form.images.value = '';
      status.textContent = `本任务最多上传 ${imageLimit} 张图片。`;
      await openDialog({ title: '图片数量超过限制', message: status.textContent, confirmText: '重新选择' });
      return;
    }
    const current = {
      controller: new AbortController(),
      items: [],
      uploadPromise: null
    };
    session = current;
    try {
      for (const file of files) {
        const sourceFile = await normalizeSourceImage(file);
        if (current !== session) return;
        const previewUrl = URL.createObjectURL(sourceFile);
        mediaPreviewUrls.add(previewUrl);
        current.items.push({
          sourceFile,
          previewUrl,
          idempotencyKey: createIdempotencyKey(),
          compressed: null,
          mediaId: null,
          error: null
        });
      }
      renderPreviews(preview, current.items.map((item) => ({ previewUrl: item.previewUrl })));
      recordPerf('preview', {
        imageCount: current.items.length,
        duration: roundedDuration(previewStartedAt),
        navigationEpoch
      });
      void uploadCurrentSession(current);
    } catch (error) {
      if (current !== session || current.controller.signal.aborted) return;
      status.textContent = error.message || '图片处理失败，请重新选择图片。';
      updateReadyState();
      await openDialog({ title: '图片处理失败', message: status.textContent, confirmText: '重新选择' });
    }
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const submitStartedAt = performance.now();
    let submitSucceeded = false;
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    if (session?.uploadPromise) {
      status.textContent = '图片仍在上传，请稍候…';
      await session.uploadPromise.catch(() => null);
    }
    const mediaIds = session?.items?.map((item) => item.mediaId).filter(Boolean) || [];
    if (!session?.items?.length || mediaIds.length !== session.items.length) {
      status.textContent = '图片尚未全部就绪，请重试失败图片。';
      restoreButton();
      updateReadyState();
      return;
    }
    try {
      const result = await api(`/api/tasks/${task.id}/member-checkin`, {
        method: 'PUT',
        body: JSON.stringify({
          occurrenceDate: task.occurrenceDate,
          mediaIds
        })
      });
      patchStudentTask(task.id, (cachedTask) => {
        const memberAlreadyCompleted = Boolean(cachedTask.memberCheckin);
        const members = cachedTask.teamProgress?.members?.map((member) => (
          member.id === user.id ? { ...member, checked: true } : member
        )) || [];
        return {
          ...cachedTask,
          memberCheckin: {
            id: cachedTask.memberCheckin?.id || `confirmed:${mediaIds[0]}`,
            userId: user.id,
            imageCount: Number(result.imageCount || mediaIds.length),
            occurrenceDate: result.occurrenceDate || task.occurrenceDate
          },
          teamProgress: cachedTask.teamProgress ? {
            ...cachedTask.teamProgress,
            completed: memberAlreadyCompleted
              ? cachedTask.teamProgress.completed
              : Math.min(cachedTask.teamProgress.total, cachedTask.teamProgress.completed + 1),
            members
          } : null
        };
      });
      releaseSession();
      submitSucceeded = true;
      returnToCachedStudentHome('个人打卡成功');
    } catch (error) {
      alert(error?.message || '打卡提交失败，请稍后重试。');
      restoreButton();
    } finally {
      if (session) updateReadyState();
      recordPerf('submit', {
        action: 'member-checkin',
        success: submitSucceeded,
        imageCount: mediaIds.length,
        duration: roundedDuration(submitStartedAt),
        navigationEpoch
      });
    }
  };
}
