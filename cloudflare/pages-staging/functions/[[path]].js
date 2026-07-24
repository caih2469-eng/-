import worker from '../../worker.js';

export const onRequest = (context) => worker.fetch(context.request, context.env, context);
