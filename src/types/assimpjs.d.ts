/**
 * Minimal ambient types for `assimpjs` (a WASM build of Assimp that ships no
 * type declarations). Covers only the file-list → convert → read-result surface
 * the model validator uses.
 */
declare module "assimpjs" {
  interface AssimpFile {
    GetContent(): Uint8Array
  }

  interface AssimpResult {
    IsSuccess(): boolean
    GetErrorCode(): string
    GetFile(index: number): AssimpFile
  }

  interface AssimpFileList {
    AddFile(path: string, content: Uint8Array): void
  }

  interface AssimpModule {
    FileList: new () => AssimpFileList
    /** `format` is an Assimp exporter id, e.g. "assjson" or "gltf2". */
    ConvertFileList(fileList: AssimpFileList, format: string): AssimpResult
  }

  const assimpjs: () => Promise<AssimpModule>
  export default assimpjs
}
