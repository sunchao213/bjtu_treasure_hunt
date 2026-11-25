import type { StoragePort } from '../modules/save/reference-save';
import { TRIAL_NAMESPACE } from './map';

/** Prefix every read as well as every write, including legacy migration lookups. */
export function trialStorage(storage: StoragePort): StoragePort {
  return {
    getItem: (key) => storage.getItem(`${TRIAL_NAMESPACE}${key}`),
    setItem: (key, value) => storage.setItem(`${TRIAL_NAMESPACE}${key}`, value),
  };
}
