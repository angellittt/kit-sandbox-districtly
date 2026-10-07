export type ServerConfig = {
  port: number;
  host: string;
  env: "development" | "test" | "staging" | "production";
};
