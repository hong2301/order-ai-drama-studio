declare module "sql.js" {
  export interface SqlJsStatic {
    Database: { new (data?: Uint8Array | number[]): Database };
  }
  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string, params?: unknown[]): { columns: string[]; values: unknown[][] }[];
    prepare(sql: string): PreparedStatement;
    export(): Uint8Array;
    close(): void;
  }
  export interface PreparedStatement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }
  export default function initSqlJs(
    config?: { locateFile?: (file: string) => string }
  ): Promise<SqlJsStatic>;
}