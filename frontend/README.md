# SD-AI Frontend
A user friendly homepage for the project currently running at: [https://ub-iad.github.io/sd-ai/](https://ub-iad.github.io/sd-ai/)

## Development Setup
- this project is a frontend only React single page application 
- it lives in it's own world in the `frontend` folder, it has it's own dependencies and `package.json` seperate from the rest of the `sd-ai` project
- it uses the main `sd-ai` node application as it's backend

### Getting Started
- if you're going to be making heavy use of the backend please use your own local server instead of the server listed in `src/services/api.js`
```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

## Production Setup 
This frontend code is hosted by Github Pages. The backend is hosted by the Skip Designed (CoModel) team for the time being.

### Deployment
- assuming you're mostly working off of your own fork of the project
- checkout the most recent code on `main` branch of the ub-iad fork ` git checkout upstream && git pull upstream `
  - if you don't have upstream avalaible locally you can add it:
    - `git remote add upstream git@github.com:UB-IAD/sd-ai.git `
    - ` git checkout -b upstream upstream/main `
```bash
cd frontend
npm run build
npx gh-pages -d dist -o upstream
```
- this will take the code you have running in your current git environment and compile it
- then take that compiled code and create a new commit to `gh-pages` on github (you need to have permission to do this)
- github should then trigger a github pages redeploy to refresh the content
