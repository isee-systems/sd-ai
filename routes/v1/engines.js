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
    
    //sort them so that qualitative comes first for old stella clients!
    const qualIndex = engines.findIndex((engine) => {
        return engine.name === 'qualitative';
    });

    if (qualIndex >= 0) {
        let qualEngine = engines.splice(qualIndex, 1)[0];
        engines.unshift(qualEngine);
    }
    
    return res.send({
        success: true, 
        engines: engines,
        recommendedDefaults: {
            "sfd": "quantitative",
            "cld": "qualitative",
            "sfd-discuss": "seldon",
            "cld-discuss": "seldon"
        }
    });
})

export default router;