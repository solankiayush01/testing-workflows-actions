const fs = require('fs').promises;
const { parseString } = require('xml2js');
const path = require('path');

// moodle download link
const DOWNLOAD_LINK_PREFIX = "https://download.moodle.org/download.php/stable";

/**
 * Function to strip the moodle version code from a url
 * 
 * @param {string} url - the url fetched from moodleversions file named as upgradePath
 * @returns {string} - A stable code like 401, 39, 400 etc
 */
function getMoodleVersionCode(url) {

  // url like -> "https://docs.moodle.org/401/en/Upgrading",
  const splitUrl = url.split("/");
  return splitUrl[3];
}

/**
 * Function to generate latest moodle download url
 * eg of url -> https://download.moodle.org/download.php/stable311/moodle-latest-311
 * 
 * @param {string} versionCode - The version code of moodle
 * @returns {string} - The download url
 */
function generateLatestDownloadLink(versionCode) {
  return `${DOWNLOAD_LINK_PREFIX}${versionCode}/moodle-latest-${versionCode}`;
}

/**
 * Function to generate moodle download url other than latest
 * eg of url -> https://download.moodle.org/download.php/stable39/moodle-3.9
 * 39 is code and 3.9 is version
 * 
 * @param {string} versionCode - The version code of moodle
 * @param {string} version - The version of moodle
 * @returns {string} - The download url
 */
function generateOtherDownloadLink(versionCode, version) {
  return `${DOWNLOAD_LINK_PREFIX}${versionCode}/moodle-${version}`;
}

/**
 * Function to create Requirement key values for version json
 * 
 * @param {object} singleEnvironmentObj - the environment file single object
 * @returns {object} - the requirements object
 */
function createRequirementsObject(environment) {

  const requirements = {};

  // extract all databases
  const allDatabases = environment["DATABASE"][0]["VENDOR"];

  for (let i = 0; i < allDatabases.length; ++i) {
    const currentDatabase = allDatabases[i];
    requirements[currentDatabase["name"][0]] = currentDatabase["version"][0];
  }

  // php verion and requires versions info
  requirements["PHP"] = environment["PHP"][0]["version"][0];
  requirements["requires"] = environment["requires"][0];

  return requirements;
}

/**
 * Function to write data in the versions.json file
 * 
 * @param {object} fileData - the json object needs to written in ./data.versions.json file
 */
function writeVersionFile(fileData) {

  console.log("Writing version.json file")

  // Set the path to the folder and file
  const folderName = 'data';
  const fileName = 'versions.json';
  const folderPath = path.join(__dirname, folderName);
  const filePath = path.join(folderPath, fileName);
  const data = JSON.stringify(fileData, null, 4);

  // Check if the folder exists
  fs.access(folderPath)
    .then(() => {
      // Folder exists, write the file
      return fs.writeFile(filePath, data);
    })
    .then(() => {
      console.log(`File written to ${filePath}`);
    })
    .catch((err) => {
      if (err.code === 'ENOENT') {
        // Folder does not exist, create it and write the file
        return fs.mkdir(folderPath, { recursive: true })
          .then(() => fs.writeFile(filePath, data))
          .then(() => {
            console.log(`File written to ${filePath}`);
          });
      }
      throw err;
    });

}


/**
 * Function to merge data of both files
 * 
 * @param {object} versionsData - the versions file data
 * @param {object} envData - the environment file data
 */
function mergeData(versionsData, envData) {

  console.log("Merging files")

  // array to store latest Lts Data
  let latestLtsData = [];

  // count of lts versions found in versionData
  let ltsVersionsFound = 0;

  let versionDataIndex = 0;

  // strip the last 3 latest lts versions data
  while (ltsVersionsFound < 3 && versionDataIndex < versionsData["versions"].length) {

    const currentVersionData = versionsData["versions"][versionDataIndex];

    // increase the count of lts version found
    if (currentVersionData["isLTS"] === true) ltsVersionsFound++;

    // push only if current version have some releases ( no releases in case of latest announced versions )
    if (currentVersionData["releases"].length) latestLtsData.push(currentVersionData);

    ++versionDataIndex;
  }

  // map the data with download links of releases
  latestLtsData = latestLtsData.map((currentVersion) => {

    // get the current version code from the url specified in first release
    const versionCode = getMoodleVersionCode(currentVersion["releases"][0]["upgradePath"]);

    const currentReleases = currentVersion["releases"].map((currentRelease, index) => {

      const downloadUrls = {
        "zip": "",
        "tgz": ""
      }

      // first version 
      // example  https://download.moodle.org/download.php/stable39/moodle-3.9.tgz
      if (index == 0) {
        const link = generateOtherDownloadLink(versionCode, currentVersion.name)
        downloadUrls.zip = `${link}.zip`;
        downloadUrls.tgz = `${link}.tgz`;
      }

      // latest versions
      // example = https://download.moodle.org/download.php/stable311/moodle-latest-311.tgz
      else if (index == currentVersion["releases"].length - 1 && !currentRelease["notes"]) {
        const link = generateLatestDownloadLink(versionCode)
        downloadUrls.zip = `${link}.zip`;
        downloadUrls.tgz = `${link}.tgz`;
      }

      // normal versions
      else {
        const link = generateOtherDownloadLink(versionCode, currentRelease.name)
        downloadUrls.zip = `${link}.zip`;
        downloadUrls.tgz = `${link}.tgz`;
      }

      return { ...currentRelease, ...downloadUrls };
    })

    return { ...currentVersion, "releases": currentReleases };
  })

  // check the last lts to strip environment file data
  const lastlts = latestLtsData[latestLtsData.length - 1].name;

  // extract the main environment data 
  const allEnvData = envData["COMPATIBILITY_MATRIX"]["MOODLE"];

  let envDataIndex = 0;

  // skip the unused versions
  while (envDataIndex < allEnvData.length) {
    if (allEnvData[envDataIndex]["version"][0] == lastlts) {
      break;
    }
    ++envDataIndex;
  }

  // requirement object to store requirements of all versions
  const requirementData = {};

  // store the info by the createRequirementsObject function
  while (envDataIndex < allEnvData.length) {
    requirementData[allEnvData[envDataIndex]["version"][0]] = createRequirementsObject(allEnvData[envDataIndex]);
    ++envDataIndex;
  }

  // iterate over the LTS version data to appned the environment requirement data 
  for (let i = 0; i < latestLtsData.length; ++i) {

    let currentVersion = latestLtsData[i].name;

    // skip if environment doesn't exist of any version
    if (!requirementData[currentVersion]) continue;

    // extract requires info from object and then delete the key
    latestLtsData[i]["requires"] = requirementData[currentVersion]["requires"];
    delete requirementData[currentVersion]["requires"];

    latestLtsData[i]["requirements"] = requirementData[currentVersion];
  }

  // write data to file
  writeVersionFile(latestLtsData);

}

/**
 * Main function to execute all the workflow and generate a file 
 */
async function main() {
  console.log("Start executing main function");

  try {
    // Read the contents of the XML file
    const environmentXML = await fs.readFile('./environment/environment.xml');

    // Read the constent of versions.json which 
    const versionsData = JSON.parse(await fs.readFile('moodleVersions.json', 'utf-8'));

    // Parse the XML data using the xml2js module
    parseString(environmentXML, { mergeAttrs: true }, (err, result) => {
      if (err) {
        throw err
      }

      const envData = JSON.parse(JSON.stringify(result));

      mergeData(versionsData, envData);
    });

  } catch (err) {
    console.log(err)
  }
}

// call main function to perform operation
main();
