declare module 'virtual:a204-audio' {
  /** Required banks are validated by the build plugin; extras are author-defined. */
  const banks: Readonly<Record<string, readonly string[]>> & {
    readonly step: readonly string[];
    readonly impact: readonly string[];
  };
  export default banks;
}
