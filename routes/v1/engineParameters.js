import express from 'express'

const router = express.Router()

router.get("/:engine/parameters", async (req, res) => {
    const engine = await import(`./../../engines/${req.params.engine}/engine.js`);
    const instance = new engine.default();

    const baseParameters = [{
            name: "prompt",
            type: "string",
            required: true,
            uiElement: "textarea",
            label: "Prompt",
            description: "Description of desired model or changes to model."
        }, {
            name: "format",
            type: "string",
            defaultValue: "sd-json",
            required: true,
            options: [{value: "sd-json"}, {value: "xmile"}],
            uiElement: "hidden",
            description: "How you want the diagram information returned, XMILE or sd-json format"
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