import { EventEmitter } from "node:events";

export const globalBus = new EventEmitter();
globalBus.setMaxListeners(100);
