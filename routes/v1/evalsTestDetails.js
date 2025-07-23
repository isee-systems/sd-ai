import express from 'express'

const router = express.Router()

router.get("/:category/:group/:testname", async (req, res) => {
    const { category, group, testname } = req.params
    
    try {
        // Import the category module
        const categoryModule = await import(`./../../evals/categories/${category}.js`)
        
        // Check if the group exists
        if (!categoryModule.groups || !categoryModule.groups[group]) {
            return res.status(404).send({
                success: false,
                error: `Group '${group}' not found in category '${category}'`
            })
        }
        
        // Find the specific test
        const tests = categoryModule.groups[group]
        const test = tests.find(t => t.name === testname)
        
        if (!test) {
            return res.status(404).send({
                success: false,
                error: `Test '${testname}' not found in group '${group}' of category '${category}'`
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
            error: `Category '${category}' not found or could not be loaded: ${error.message}`
        })
    }
})

export default router;
