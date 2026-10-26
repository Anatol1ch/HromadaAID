export type ReleaseArtifact = { component: 'installer' | 'server'; name: string; sha256: string; sizeBytes: number; packageIntegrity?: string }
export type ReleaseCheck = { available: false; checkedAt: string } | { available: true; checkedAt: string; version: string; notes: string; artifact: ReleaseArtifact; url: string }
export function parseStableVersion(value: unknown): { major: number; minor: number; patch: number; prerelease: string[] } | null
export function compareVersions(left: string, right: string): number
export function validateRepository(value: unknown): string
export function validateReleaseManifest(value: unknown, release: any, currentVersion: string): ({ version: string; notes: string; artifact: ReleaseArtifact } | null)
export function safeReleaseNotes(value: unknown): string
export function checkLatestRelease(options: { repository: string; currentVersion: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<ReleaseCheck>
export function downloadVerifiedArtifact(options: { url: string; artifact: ReleaseArtifact; directory: string; fetchImpl?: typeof fetch; timeoutMs?: number; onProgress?: (progress: { receivedBytes: number; totalBytes: number }) => void }): Promise<string>
