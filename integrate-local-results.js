#!/usr/bin/env node
/**
 * Script to integrate local LLM benchmark results into the existing leaderboard system
 * Usage: node integrate-local-results.js <results-file.json>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.join(__dirname, 'evals/results');

/**
 * Merge local LLM results with existing leaderboard data
 * @param {string} resultsFilePath - Path to the local results JSON file
 * @param {string} targetMode - Target mode ('cld' or 'sfd')
 */
async function integrateResults(resultsFilePath, targetMode = 'local') {
    try {
        console.log(`🚀 Integrating results from: ${resultsFilePath}`);
        
        // Read the local results file
        if (!fs.existsSync(resultsFilePath)) {
            throw new Error(`Results file not found: ${resultsFilePath}`);
        }
        
        const localResults = JSON.parse(fs.readFileSync(resultsFilePath, 'utf8'));
        console.log(`📊 Found ${localResults.results?.length || 0} local results`);
        
        // Create results directory if it doesn't exist
        if (!fs.existsSync(RESULTS_DIR)) {
            fs.mkdirSync(RESULTS_DIR, { recursive: true });
        }
        
        // Generate target filename
        const targetFile = path.join(RESULTS_DIR, `leaderboard_${targetMode}_full_results.json`);
        
        let mergedResults = localResults;
        
        // If target file exists, merge with existing results
        if (fs.existsSync(targetFile)) {
            console.log(`📄 Found existing results file: ${targetFile}`);
            const existingResults = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
            
            // Merge results arrays
            mergedResults = {
                ...existingResults,
                results: [
                    ...(existingResults.results || []),
                    ...(localResults.results || [])
                ]
            };
            console.log(`🔄 Merged with existing results. Total: ${mergedResults.results.length}`);
        }
        
        // Write merged results
        fs.writeFileSync(targetFile, JSON.stringify(mergedResults, null, 2));
        console.log(`✅ Successfully wrote results to: ${targetFile}`);
        
        // Generate summary statistics
        generateSummary(mergedResults, targetMode);
        
    } catch (error) {
        console.error(`❌ Error integrating results:`, error.message);
        process.exit(1);
    }
}

/**
 * Generate summary statistics for the results
 * @param {Object} results - The merged results object
 * @param {string} mode - The mode (local, cld, sfd, etc.)
 */
function generateSummary(results, mode) {
    console.log(`\n📈 Summary for ${mode} results:`);
    
    const models = [...new Set(results.results.map(r => 
        r.engineConfig?.additionalParameters?.underlyingModel || 'unknown'
    ))];
    
    const categories = [...new Set(results.results.map(r => r.category))];
    
    console.log(`   Models tested: ${models.length}`);
    console.log(`   - ${models.join(', ')}`);
    console.log(`   Categories: ${categories.length}`);
    console.log(`   - ${categories.join(', ')}`);
    console.log(`   Total test runs: ${results.results.length}`);
    
    // Calculate success rates by model
    console.log(`\n📊 Success rates by model:`);
    models.forEach(model => {
        const modelResults = results.results.filter(r => 
            r.engineConfig?.additionalParameters?.underlyingModel === model
        );
        const successes = modelResults.filter(r => 
            r.failures?.length === 0 || r.failures === undefined
        );
        const successRate = ((successes.length / modelResults.length) * 100).toFixed(1);
        console.log(`   ${model}: ${successRate}% (${successes.length}/${modelResults.length})`);
    });
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
    const resultsFile = process.argv[2];
    const mode = process.argv[3] || 'local';
    
    if (!resultsFile) {
        console.log(`Usage: node integrate-local-results.js <results-file.json> [mode]`);
        console.log(`Example: node integrate-local-results.js abc_local-conservative_full_results.json local`);
        process.exit(1);
    }
    
    integrateResults(resultsFile, mode);
}

export { integrateResults, generateSummary };