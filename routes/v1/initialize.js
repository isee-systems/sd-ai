import express from 'express'
import utils from '../../engines/default/utils.js'

const router = express.Router()

router.get('/', async (req, res) => {
    const clientProduct = req.query.clientProduct;
    const clientVersion = req.query.clientVersion;

    if (!utils.supportedPlatform(clientProduct, clientVersion)) {
        res.send({success: false, message: "Your client application is not currently supported."});
        return;
    }

   return res.send({success:true, message: "Diagram generation session is ready."});
})

export default router;