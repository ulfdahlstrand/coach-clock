import type { defaultNS, resources } from './index';

// Gör t() typad mot sv.json: felstavade nycklar blir typfel i stället för att
// tyst renderas som råa nyckelsträngar.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['sv'];
  }
}
