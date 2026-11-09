/// <reference types="vite/client" />
declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_HISTORY_TURNS?: string; // earlier turns sent with each question (default 3, at most 10)
}
