import express from 'express'
import fs from 'fs'

const router = express.Router()

router.get("/", async (req, res) => {
    const evalsPath = "evals/categories"
    const categoryFiles = fs.readdirSync(evalsPath)
        .filter(f => f.endsWith('.js'))
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

export default router;
