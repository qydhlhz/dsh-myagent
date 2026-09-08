//#region src/index.d.ts
declare const name = "myagent";
declare const inject: string[];
declare function apply(ctx: any, config: any): void;
//#endregion
export { apply, inject, name };