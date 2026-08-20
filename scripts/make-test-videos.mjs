#!/usr/bin/env node
/**
 * Generates deterministic test footage in .test-assets/ with ffmpeg:
 * 12 solid-color 640x360 clips (their colors are asserted pixel-by-pixel in the tests)
 * + 2 patterned clips with different sizes/aspects (cover/contain/stretch paths).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, '.test-assets')
mkdirSync(dir, { recursive: true })

// saturated, well-separated colors that survive H.264 yuv420 round-tripping recognizably
export const COLORS = {
  'clip-01.mp4': 'C81E1E', 'clip-02.mp4': '1EC828', 'clip-03.mp4': '1E32C8', 'clip-04.mp4': 'C8C81E',
  'clip-05.mp4': 'C81EC8', 'clip-06.mp4': '1EC8C8', 'clip-07.mp4': 'E67E22', 'clip-08.mp4': '8E44AD',
  'clip-09.mp4': '154360', 'clip-10.mp4': '7DCEA0', 'clip-11.mp4': '78281F', 'clip-12.mp4': 'D5D8DC',
}

const jobs = []
for (const [name, hex] of Object.entries(COLORS)) {
  jobs.push({ name, args: ['-f', 'lavfi', '-i', `color=c=0x${hex}:s=640x360:d=6:r=30`] })
}
jobs.push({ name: 'pattern-hd.mp4', args: ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=6:r=30'] })
jobs.push({ name: 'pattern-vertical.mp4', args: ['-f', 'lavfi', '-i', 'smptebars=s=540x960:d=6:r=30'] })

for (const j of jobs) {
  const out = join(dir, j.name)
  if (existsSync(out)) continue
  execFileSync('ffmpeg', ['-y', ...j.args, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', out], { stdio: 'pipe' })
  console.log('made', j.name)
}
writeFileSync(join(dir, 'colors.json'), JSON.stringify(COLORS, null, 2))
console.log('test footage ready in', dir)
