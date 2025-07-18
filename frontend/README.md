# Frontend - CLD Relationship Comparison Tool

## Purpose
- create a simple html, css, js (react) app w/ no server side component
- for comparing a list of relationships found in a causal loop diagram side by side

## Deployment
This app is deployed to GitHub Pages at: https://dgcoskip.github.io/sd-ai-evals

### Manual Deployment
To deploy manually:
```bash
npm run deploy
```

### Automatic Deployment
The app is automatically deployed via GitHub Actions when changes are pushed to the main branch that affect the `frontend/` directory.

## Details
- interface is populated with as many horizontally layed out cards as the user desires
- each card has a width of 500px
- to the right of the last card will always be a button saying "add new cld"
- each card has a bar at the top for title and actions
- and a details section
- details section can be in json mode or relationship mode
    - create a simple button icon for toggling between these modes in the bar at the top
- in json mode the json representation of the cld is pretty printed into a standard textarea
- in the relationship mode each relationship in the cld is listed on a new line
- by default relationships are order alphabetically by to and then by from
- but user should be able to drag and drop relationships to create a new order (use the dnd kit, libary w/ sortable)
- a relationship is two variables with a polarity in between
- each relationship should be a seperate text input that turns into a div when not selected
- the polarity should be a button in between each varaible that toggles from + to - when pressed 
- editing text we should have aggressive tab complete options that automatically show prediction in greyed out text for other variables that have already been used