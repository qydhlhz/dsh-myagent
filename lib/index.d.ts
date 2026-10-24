declare const name = "myagent";
declare const inject: string[];
declare function apply(ctx: any, config: any): void;
export { apply, inject, name };