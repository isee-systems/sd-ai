import express from 'express'
import { evalCategoryNames } from './engineRegistry.js'

const router = express.Router()

router.get("/:category/:group/:testname", async (req, res) => {
    const { category, group, testname } = req.params

    // `category` is interpolated straight into a dynamic import specifier, and
    // Express decodes %2f in a route param after matching — so without this the
    // caller chooses which module gets imported and executed. `group` and
    // `testname` are only ever used as object keys, so they need no allowlist.
    if (!evalCategoryNames().has(category)) {
        return res.status(404).send({
            success: false,
            message: `Category '${category}' not found`
        })
    }

    try {
        // Import the category module
        const categoryModule = await import(`./../../evals/categories/${category}.js`)

        // Check if the group exists
        if (!categoryModule.groups || !categoryModule.groups[group]) {
            return res.status(404).send({
                success: false,
                message: `Group '${group}' not found in category '${category}'`
            })
        }
        
        // Find the specific test
        const tests = categoryModule.groups[group]
        const test = tests.find(t => t.name === testname)
        
        if (!test) {
            return res.status(404).send({
                success: false,
                message: `Test '${testname}' not found in group '${group}' of category '${category}'`
            })
        }
        
        return res.send({
            success: true,
            test: test
        })
        
    } catch (error) {
        // Handle case where category doesn't exist or other import errors
        return res.status(404).send({
            success: false,
            message: `Category '${category}' not found or could not be loaded: ${error.message}`
        })
    }
})

export default router;
