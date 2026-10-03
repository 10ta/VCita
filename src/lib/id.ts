import { v7 } from 'uuid';

/** UUIDv7：带时间顺序的标准 UUID（RFC 9562） */
export const newId = (): string => v7();
