import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// Get leaderboard data for a specific mode (cld or sfd)
router.get('/:mode', async (req, res) => {
  try {
    const { mode } = req.params
    
    // Validate mode
    if (!['cld', 'sfd'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mode. Must be either "cld" or "sfd"'
      })
    }
    
    const filename = `leaderboard${mode.toUpperCase()}_full_results.json`
    const filePath = path.join(__dirname, '../../evals/results', filename)
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: `Leaderboard data not found for mode: ${mode}`
      })
    }
    
    // Read and parse the JSON file
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(fileContent)
    
    res.json({
      success: true,
      data: data
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

// Get list of available leaderboard modes
router.get('/', async (req, res) => {
  try {
    const resultsDir = path.join(__dirname, '../../evals/results')
    
    if (!fs.existsSync(resultsDir)) {
      return res.json({
        success: true,
        modes: [],
        message: 'No leaderboard results available'
      })
    }
    
    const files = fs.readdirSync(resultsDir)
    const leaderboardFiles = files.filter(file => 
      file.startsWith('leaderboard') && file.endsWith('_full_results.json')
    )
    
    const modes = leaderboardFiles.map(file => {
      const match = file.match(/leaderboard([A-Z]+)_full_results\.json/)
      return match ? match[1].toLowerCase() : null
    }).filter(Boolean)
    
    res.json({
      success: true,
      modes,
      available: modes.map(mode => ({
        mode,
        title: mode === 'cld' ? 'Causal Loop Diagrams' : 'Stock & Flow Diagrams',
        endpoint: `/api/v1/leaderboard/${mode}`
      }))
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
