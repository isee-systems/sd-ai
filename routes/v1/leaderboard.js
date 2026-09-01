import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  LEADERBOARD_MODES,
  LEADERBOARD_GENERATIONS,
  leaderboardResultsFilename,
  findGeneration,
  generationsIn,
  generationOf,
} from '../../evals/leaderboardGenerations.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

const RESULTS_DIR = path.join(__dirname, '../../evals/results')

function resultsPath (mode) {
  return path.join(RESULTS_DIR, leaderboardResultsFilename(mode))
}

// Get leaderboard data for a specific mode (cld, sfd or discussion).
//
// One file per board holds every generation, so the default is the whole thing —
// unchanged from before generations existed. `?generation=v2` filters the rows down to
// one generation for a caller that only wants the current board.
router.get('/:mode', async (req, res) => {
  try {
    const { mode } = req.params
    const requestedGeneration = req.query.generation

    // `mode` lands in a filename that is then path.join'd. A percent-encoded
    // separator survives route matching and is decoded before we see it, so
    // `x%2f..%2f..%2fetc%2fpasswd` would join out of evals/results entirely.
    // Matching against the known list keeps it a single path component.
    const normalizedMode = String(mode).toLowerCase()
    if (!LEADERBOARD_MODES.includes(normalizedMode)) {
      return res.status(404).json({
        success: false,
        message: `Leaderboard data not found for mode: ${mode}`
      })
    }

    const filePath = resultsPath(normalizedMode)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: `Leaderboard data not found for mode: ${mode}`
      })
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const results = data.results ?? []
    const present = generationsIn(results)

    if (requestedGeneration === undefined) {
      return res.json({
        success: true,
        generations: present,
        currentGeneration: present[present.length - 1] ?? null,
        data: data
      })
    }

    // Resolved against the declared list rather than trusted as a filter value, so an
    // unknown id is a clear 404 instead of a silently empty leaderboard.
    const generation = findGeneration(String(requestedGeneration))
    if (!generation || !present.includes(generation.id)) {
      return res.status(404).json({
        success: false,
        message: `No "${requestedGeneration}" results for mode: ${normalizedMode}`,
        generations: present
      })
    }

    res.json({
      success: true,
      generations: present,
      currentGeneration: present[present.length - 1] ?? null,
      generation: generation.id,
      data: { ...data, results: results.filter((r) => generationOf(r) === generation.id) }
    })
  } catch (error) {
    console.error('Error fetching leaderboard data:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard data',
      details: error.message
    })
  }
})

const MODE_TITLES = {
  cld: 'Causal Loop Diagrams',
  sfd: 'Stock & Flow Diagrams',
  discussion: 'Discussion'
}

// Get list of available leaderboard modes, and the generations each one has.
router.get('/', async (req, res) => {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      return res.json({
        success: true,
        modes: [],
        message: 'No leaderboard results available'
      })
    }

    // Derived from the known mode list and what is on disk. The previous version
    // pattern-matched filenames with a regex that could not match them (it expected
    // `leaderboardCLD_...`, the files are `leaderboard_cld_...`), so this endpoint
    // always reported zero modes.
    //
    // Which generations a board actually contains is deliberately NOT reported here:
    // it would mean parsing every results file (tens of MB each) on a request whose
    // whole job is to be a cheap index. `GET /:mode` reports it, having read the file.
    const available = LEADERBOARD_MODES
      .filter((mode) => fs.existsSync(resultsPath(mode)))
      .map((mode) => ({
        mode,
        title: MODE_TITLES[mode] ?? mode,
        endpoint: `/api/v1/leaderboard/${mode}`,
        generations: LEADERBOARD_GENERATIONS.map((g) => ({
          id: g.id,
          label: g.label,
          description: g.description,
          ...(g.caveat ? { caveat: g.caveat } : {}),
          endpoint: `/api/v1/leaderboard/${mode}?generation=${g.id}`
        }))
      }))

    res.json({
      success: true,
      modes: available.map((a) => a.mode),
      available
    })
  } catch (error) {
    console.error('Error listing leaderboard modes:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to list leaderboard modes',
      details: error.message
    })
  }
})

export default router
