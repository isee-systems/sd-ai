let reporterAdded = false;

export default function setup() {
  if (reporterAdded)
    return;

  jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

  reporterAdded = true;
  
  const myReporter = {
      specDone: (result) => {
          console.log("")
          console.log(JSON.stringify(result))
          console.log("")
      }
  };
  jasmine.getEnv().addReporter(myReporter);
}