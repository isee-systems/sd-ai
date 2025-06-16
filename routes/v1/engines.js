import express from 'express'
import fs from 'fs'

const router = express.Router()
const quantitativeEngines = ['quantitative'];

router.get("/", async (req, res) => {
    const path = "engines"
    const dirs = fs.readdirSync(path).filter(f => fs.lstatSync(`${path}/${f}`).isDirectory());

    const engines = [];
    for (const dir of dirs) {
        const engine = await import(`./../../engines/${dir}/engine.js`);
        const supportedModes = engine.default.supportedModes();
        if (supportedModes && supportedModes.length > 0) {
            engines.push({
                name: dir,
                supports: supportedModes,
            });
        }
    }
    
    return res.send({
        success: true, 
        engines: engines,
        recommendedDefaults: {
            "sfd": "quantitative",
            "cld": "default",
            "sfd-discuss": "seldon",
            "cld-discuss": "seldon"
        }
    });
})

export default router;