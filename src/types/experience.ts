/**
 * TypeScript shape of the ExperienceData JSON document. Intentionally loose:
 * element shapes are polymorphic, and unknown fields must survive a round-trip
 * untouched.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SceneElementData {
  id: string
  type: string // Content | Model3D | Hotspot (open set)
  [key: string]: unknown
}

export interface EnvironmentData {
  id: string
  type: string // Video360 | Photo360 | Model3D (open set)
  assetPath?: string
  startRotationY?: number
  onVideoEnd?: string // Loop | Stop; absent = Loop
  endMessage?: string // Stop end-panel text (literal or string key); absent = player default
  endButtonText?: string // Stop end-panel restart label (literal or string key); absent = player default
  elements?: SceneElementData[]
  [key: string]: unknown
}

export interface ExperienceData {
  version?: string
  title?: string
  startEnvironmentId?: string
  environments: EnvironmentData[]
  [key: string]: unknown
}
