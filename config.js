/***
 * You must have a .env file which has the following keys
 * OPEN_API_KEY which is your open AI access token 
 * RESTRICT_KEY_CODE which is the code that unlocks the open ai key if restrictKey is on
 * 
 */

const config = {
    "port": 3000,
    "restrictKey": true
};

export default config