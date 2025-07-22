import express from 'express'
import fs from 'fs'

const router = express.Router()

/**
 * Calculate navigation information for a specific test
 * @param {Object} groups - The groups object from the category module
 * @param {String} category - The category name
 * @param {String} group - The group name
 * @param {String} testname - The test name
 * @returns {Object} Navigation information with nextTest, nextGroup, previousTest, and previousGroup
 */
function calculateNavigation(groups, category, group, testname) {
    const groupNames = Object.keys(groups)
    const currentGroupIndex = groupNames.indexOf(group)
    const currentGroup = groups[group]
    const currentTestIndex = currentGroup.findIndex(test => test.name === testname)
    
    let nextTest = null
    let nextGroup = null
    let previousTest = null
    let previousGroup = null
    
    // Check if there's a next test in the current group
    if (currentTestIndex >= 0 && currentTestIndex < currentGroup.length - 1) {
        const nextTestData = currentGroup[currentTestIndex + 1]
        nextTest = {
            category: category,
            group: group,
            testname: nextTestData.name,
            url: `/evals/${encodeURIComponent(category)}/${encodeURIComponent(group)}/${encodeURIComponent(nextTestData.name)}`
        }
    }
    
    // Check if there's a previous test in the current group
    if (currentTestIndex > 0) {
        const previousTestData = currentGroup[currentTestIndex - 1]
        previousTest = {
            category: category,
            group: group,
            testname: previousTestData.name,
            url: `/evals/${encodeURIComponent(category)}/${encodeURIComponent(group)}/${encodeURIComponent(previousTestData.name)}`
        }
    }
    
    // Check if there's a next group with tests
    if (currentGroupIndex >= 0 && currentGroupIndex < groupNames.length - 1) {
        const nextGroupName = groupNames[currentGroupIndex + 1]
        const nextGroupData = groups[nextGroupName]
        if (nextGroupData && nextGroupData.length > 0) {
            const firstTestInNextGroup = nextGroupData[0]
            nextGroup = {
                category: category,
                group: nextGroupName,
                testname: firstTestInNextGroup.name,
                url: `/evals/${encodeURIComponent(category)}/${encodeURIComponent(nextGroupName)}/${encodeURIComponent(firstTestInNextGroup.name)}`
            }
        }
    }
    
    // Check if there's a previous group with tests
    if (currentGroupIndex > 0) {
        const previousGroupName = groupNames[currentGroupIndex - 1]
        const previousGroupData = groups[previousGroupName]
        if (previousGroupData && previousGroupData.length > 0) {
            const lastTestInPreviousGroup = previousGroupData[previousGroupData.length - 1]
            previousGroup = {
                category: category,
                group: previousGroupName,
                testname: lastTestInPreviousGroup.name,
                url: `/evals/${encodeURIComponent(category)}/${encodeURIComponent(previousGroupName)}/${encodeURIComponent(lastTestInPreviousGroup.name)}`
            }
        }
    }
    
    return {
        nextTest: nextTest,
        nextGroup: nextGroup,
        previousTest: previousTest,
        previousGroup: previousGroup
    }
}

router.get("/", async (req, res) => {
    const evalsPath = "evals/categories"
    const categoryFiles = fs.readdirSync(evalsPath)
        .filter(f => f.endsWith('.js') && f !== 'jsdoc-conf.json')
        .map(f => f.replace('.js', ''))

    const categories = await Promise.all(
        categoryFiles.map(async (categoryName) => {
            const categoryModule = await import(`./../../evals/categories/${categoryName}.js`)
            
            const groups = Object.keys(categoryModule.groups).map(groupName => {
                const tests = categoryModule.groups[groupName]
                return {
                    name: groupName,
                    tests: tests.map(test => ({
                        name: test.name
                    }))
                }
            })
            
            // Find the first test in the first group for the browse URL
            let firstTestUrl = null
            const firstGroupName = Object.keys(categoryModule.groups)[0]
            if (firstGroupName && categoryModule.groups[firstGroupName].length > 0) {
                const firstTestName = categoryModule.groups[firstGroupName][0].name
                firstTestUrl = `/evals/${encodeURIComponent(categoryName)}/${encodeURIComponent(firstGroupName)}/${encodeURIComponent(firstTestName)}`
            }

            return {
                name: categoryName,
                groups: groups,
                link: categoryModule.link ? categoryModule.link() : null,
                description: categoryModule.description ? categoryModule.description() : '',
                source: `https://github.com/UB-IAD/sd-ai/tree/main/evals/categories/${categoryName}.js`,
                firstTestUrl: firstTestUrl
            }
        })
    )

    return res.send({
        success: true,
        categories: categories
    })
})

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
        
        // Calculate navigation information
        const navigation = calculateNavigation(categoryModule.groups, category, group, testname)
        
        return res.send({
            success: true,
            test: test,
            navigation: navigation
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