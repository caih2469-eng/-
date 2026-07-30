import { errorResponse } from '../lib/runtime.js';
import { handleMemberFastV3 } from './member-fast-v3.js';

export const handleMemberFastV3Safe = async (request, env) => {
  try {
    return await handleMemberFastV3(request, env);
  } catch (error) {
    return errorResponse(error);
  }
};
