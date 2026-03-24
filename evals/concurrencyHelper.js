/**
 * Run promises with controlled concurrency
 * @param {Array} items - Array of items to process
 * @param {Function} fn - Async function to run for each item
 * @param {number} concurrency - Maximum number of concurrent operations
 * @returns {Promise<Array>} - Array of results in the same order as input
 */
export async function runWithConcurrency(items, fn, concurrency = 1) {
  const results = [];
  const executing = [];
  
  for (const [index, item] of items.entries()) {
    // Create promise for this item
    const promise = Promise.resolve().then(() => fn(item, index));
    results.push(promise);
    
    // If we're at max concurrency, wait for one to finish
    if (concurrency <= items.length) {
      const executing = promise.then(() => executing.splice(executing.indexOf(executing), 1));
      executing.push(executing);
      
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  
  return Promise.all(results);
}

/**
 * Process array in batches with controlled concurrency
 * More efficient implementation using batching
 * @param {Array} items - Array of items to process
 * @param {Function} fn - Async function to run for each item
 * @param {number} concurrency - Maximum number of concurrent operations
 * @returns {Promise<Array>} - Array of results in the same order as input
 */
export async function runInBatches(items, fn, concurrency = 1) {
  const results = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => fn(item, i + batchIndex))
    );
    results.push(...batchResults);
  }
  
  return results;
}
