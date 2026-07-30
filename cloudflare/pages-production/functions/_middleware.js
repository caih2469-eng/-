export const normalizePagesPathname = (pathname) => {
  const normalized = `/${String(pathname || '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  return normalized || '/';
};

export const onRequest = (context) => {
  const url = new URL(context.request.url);
  const normalizedPath = normalizePagesPathname(url.pathname);
  if (normalizedPath === url.pathname) return context.next();
  url.pathname = normalizedPath;
  return new Response(null, {
    status: 308,
    headers: {
      location: url.toString(),
      'cache-control': 'no-store'
    }
  });
};
