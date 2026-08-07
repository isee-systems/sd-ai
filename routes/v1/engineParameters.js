import express from 'express'
import path from 'path'
import { engineNames } from './engineRegistry.js'

const router = express.Router()

router.get("/:engine/parameters", async (req, res) => {
    // Membership in the engines/ directory listing, NOT existsSync on a path
    // built from the parameter: Express decodes %2f in a route param after
    // matching, so `..%2f..%2ftmp` arrives here as `../../tmp` and an existsSync
    // check would happily approve importing any engine.js on the filesystem.
    if (!engineNames().has(req.params.engine)) {
        return res.status(404).send({
            success: false,
            message: `Engine "${req.params.engine}" not found`
        });
    }

    const enginePath = path.join(process.cwd(), 'engines', req.params.engine, 'engine.js');

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