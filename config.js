/***
 * You must have a .env file which has the following keys
 * OPEN_API_KEY which is your open AI access token 
 */

const config = {
    "port": 3000,
    "reporterURL": process.env.REPORTER_URL || null, // Optional URL to POST engine usage metrics
};

export default config