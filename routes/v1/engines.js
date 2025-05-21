import express from 'express'
import fs from 'fs'

const router = express.Router()
const quantitativeEngines = ['quantitative'];

router.get("/", async (req, res) => {
    const path = "engines"
    const folders = fs.readdirSync(path).filter(f => fs.lstatSync(`${path}/${f}`).isDirectory());
    
    return res.send({
        success: true, 
        engines: folders.map((folder) => {
            return {
                name: folder,
                supports: quantitativeEngines.includes(folder) ? ["sfd"] : ["cld"] 
            }
        }) 
    });
})

export default router;