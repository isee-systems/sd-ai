import express from 'express'
import fs from 'fs'
import path from 'path'

const router = express.Router()

router.get("/:engine/parameters", async (req, res) => {
    const enginePath = path.join(process.cwd(), 'engines', req.params.engine, 'engine.js');
    
    // Check if engine file exists
    if (!fs.existsSync(enginePath)) {
        return res.status(404).send({
            success: false,
            message: `Engine "${req.params.engine}" not found`
        });
    }

    const importPath = process.platform === 'win32' ? `file://${enginePath}` : enginePath;
    const engine = await import(importPath);
    const instance = new engine.default();

    const baseParameters = [{
            name: "prompt",
            type: "string",
            required: true,
            uiElement: "textarea",
            label: "Prompt",
            description: "Description of desired model or changes to model."
        }, {
            name: "currentModel",
            type: "json",
            required: false,
            defaultValue: '{"variables": [], "relationships": []}',
            uiElement: "hidden",
            description: "javascript object in sd-json format representing current model to anchor changes off of"
        }
    ];

    return res.send({
        success: true,
        parameters: [
        ...baseParameters,
        ...instance.additionalParameters()
        ]
    })
})

export default router;