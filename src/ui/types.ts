import type { EntityType } from '../detect/types';

export const TYPE_COLOR: Record<EntityType, string> = {
  PERSON: '#f6c445', ORG: '#7cc4f4', LOCATION: '#9ad18b', ADDRESS: '#79c99e', EMAIL: '#c9a0f0',
  PHONE: '#f49ac1', ID_NUMBER: '#f48b6c', CARD: '#ef6f6f', ACCOUNT: '#e89a5b', DATE_OF_BIRTH: '#b0a6f5',
  MEDICAL: '#f58fb0', FINANCIAL: '#8fd3c8', OTHER: '#c8c8c8',
};

export const TYPE_LABEL: Record<EntityType, string> = {
  PERSON: 'Person', ORG: 'Organization', LOCATION: 'Location', ADDRESS: 'Address', EMAIL: 'Email',
  PHONE: 'Phone', ID_NUMBER: 'ID number', CARD: 'Card', ACCOUNT: 'Account', DATE_OF_BIRTH: 'Date of birth',
  MEDICAL: 'Medical', FINANCIAL: 'Financial', OTHER: 'Other',
};
