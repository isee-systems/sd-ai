import express from 'express'

import config from './../../config.js'
import utils from './../../helpers/utils.js'

const router = express.Router()

router.get('/', async (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.send({success: false, message: "Failed to destroy session"});
        }
        res.send({success: true, message: "Session destroyed"});
        return;
    })
})

export default router;