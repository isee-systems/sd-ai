import express from 'express'

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