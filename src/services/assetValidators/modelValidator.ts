import { readFile } from "node:fs/promises"
import assimpjs from "assimpjs"
import { assetLimits } from "../../config/assetLimits.js"
import { AssetValidationError } from "../assetValidationError.js"

/**
 * 3D-model budget check (triangle count, distinct-texture count) via a WASM build
 * of Assimp. The whole file is loaded into WASM memory, so peak memory scales with
 * the model size.
 */

/** Lazily initialised, process-wide Assimp WASM module. */
let modulePromise: ReturnType<typeof assimpjs> | null = null
function getAssimp(): ReturnType<typeof assimpjs> {
  if (!modulePromise) modulePromise = assimpjs()
  return modulePromise
}

interface AssjsonScene {
  meshes?: Array<{ faces?: number[][] }>
  materials?: Array<{ properties?: Array<{ key?: string; value?: unknown }> }>
}

export async function validateModel(tmpPath: string, filename: string): Promise<void> {
  const { maxTriangles, maxTextures } = assetLimits.model

  const ajs = await getAssimp()
  const fileList = new ajs.FileList()
  fileList.AddFile(filename, await readFile(tmpPath))
  const result = ajs.ConvertFileList(fileList, "assjson")
  if (!result.IsSuccess()) {
    throw new AssetValidationError(
      "model.unreadable",
      {},
      `Could not parse the 3D model (${result.GetErrorCode()}). Re-export it, ideally as .glb.`
    )
  }

  let scene: AssjsonScene
  try {
    scene = JSON.parse(new TextDecoder().decode(result.GetFile(0).GetContent()))
  } catch {
    throw new AssetValidationError("model.unreadable", {}, "Could not read the parsed 3D model.")
  }

  const triangles = countTriangles(scene)
  if (triangles > maxTriangles) {
    throw new AssetValidationError(
      "model.triangles",
      { triangles, maxTriangles },
      `Model has ${triangles} triangles; the maximum is ${maxTriangles}. Decimate the mesh or export a lower-poly version (ideally as .glb).`
    )
  }

  const textures = countTextures(scene)
  if (textures > maxTextures) {
    throw new AssetValidationError(
      "model.textures",
      { textures, maxTextures },
      `Model references ${textures} textures; the maximum is ${maxTextures}. Merge materials or reduce the number of textures.`
    )
  }
}

/** Fan-triangulate every face so n-gons and quads count as (n − 2) triangles. */
function countTriangles(scene: AssjsonScene): number {
  let triangles = 0
  for (const mesh of scene.meshes ?? []) {
    for (const face of mesh.faces ?? []) {
      if (Array.isArray(face) && face.length >= 3) triangles += face.length - 2
    }
  }
  return triangles
}

/** Distinct texture references across all materials (Assimp `$tex.file` props). */
function countTextures(scene: AssjsonScene): number {
  const refs = new Set<string>()
  for (const material of scene.materials ?? []) {
    for (const prop of material.properties ?? []) {
      if (prop.key === "$tex.file" && typeof prop.value === "string") refs.add(prop.value)
    }
  }
  return refs.size
}
