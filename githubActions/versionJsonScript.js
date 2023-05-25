import { readFile, access, mkdir, writeFile } from "fs/promises";
import { parseString } from "xml2js";
import path from "path";
import fetch from "node-fetch";

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
async function writeVersionFile(fileData) {
    console.log("Writing version.json file");

    // Set the path to the folder and file
    const folderName = "../data";
    const fileName = "versions.json";
    const __dirname = new URL(".", import.meta.url).pathname;
    const folderPath = path.join(__dirname, folderName);
    const filePath = path.join(folderPath, fileName);
    const data = JSON.stringify(fileData, null, 4);

    try {
        await access(folderPath);
        // Folder exists, write the file
        await writeFile(filePath, data);
        console.log(`File written to ${filePath}`);
    } catch (err) {
        if (err.code === "ENOENT") {
            // Folder does not exist, create it and write the file
            await mkdir(folderPath, { recursive: true });
            await writeFile(filePath, data);
            console.log(`File written to ${filePath}`);
        } else {
            throw err;
        }
    }
}

/**
 * Function to check weather a given link is correct or not
 * 
 * @param {string} link - the link needs to check is it correct or not 
 * @returns {boolean} true if the link is correct otherwise false
 */
async function checkCorrectLink(link) {
    try {
        const response = await fetch(link);
        const status = response.status;
        if (status >= 400) {
            throw new Error(`Link ${link} returned status ${status}`);
        }
        return true;
    } catch (error) {
        console.error(`Error checking link response code: ${error}`);
        return false;
    }
}

/**
 * Function to generate download links object and return it
 * 
 * @param {string} link - the link prefix
 * @returns {object} - the object that contains zip and tgz links 
 */
async function generateDownloadLinksObject(link) {

    const isLinkValid = await checkCorrectLink(`${link}.zip`);

    let isRemovedLink = false;

    if (!isLinkValid) {
        const isRemovedLinkValid = await checkCorrectLink(`${link}.zip.removed`);

        if (!isRemovedLinkValid) process.exit(1);

        else isRemovedLink = true;

    }

    const downloadLinks = {
        zip: isRemovedLink ? `${link}.zip.removed` : `${link}.zip`,
        tgz: isRemovedLink ? `${link}.tgz.removed` : `${link}.tgz`,
    }

    return downloadLinks;
}

/**
 * Function to merge data of both files
 *
 * @param {object} versionsData - the versions file data
 * @param {object} envData - the environment file data
 */
async function mergeData(versionsData, envData) {
    console.log("Merging files");

    // array to store latest Lts Data
    let latestLtsData = [];

    // count of lts versions found in versionData
    let ltsVersionsFound = 0;

    let versionDataIndex = 0;

    // strip the last 3 latest lts versions data
    while (
        ltsVersionsFound < 3 &&
        versionDataIndex < versionsData["versions"].length
    ) {
        const currentVersionData = versionsData["versions"][versionDataIndex];

        // increase the count of lts version found
        if (currentVersionData["isLTS"] === true) ltsVersionsFound++;

        // push only if current version have some releases ( no releases in case of latest announced versions )
        if (currentVersionData["releases"].length)
            latestLtsData.push(currentVersionData);

        ++versionDataIndex;
    };

    // map the data with download links of releases
    latestLtsData = await Promise.all(latestLtsData.map(async (currentVersion) => {
        // get the current version code from the url specified in first release
        const versionCode = getMoodleVersionCode(
            currentVersion["releases"][0]["upgradePath"]
        );

        const currentReleases = await Promise.all(currentVersion["releases"].map(
            async (currentRelease, index) => {

                let downloadUrls = {};

                // first version
                // example  https://download.moodle.org/download.php/stable39/moodle-3.9.tgz
                if (index == 0) {
                    const link = generateOtherDownloadLink(
                        versionCode,
                        currentVersion.name
                    );

                    downloadUrls = await generateDownloadLinksObject(link);

                }

                // latest versions
                // example = https://download.moodle.org/download.php/stable311/moodle-latest-311.tgz
                else if (index == currentVersion["releases"].length - 1 && !currentRelease["notes"]) {
                    const link = generateLatestDownloadLink(versionCode);

                    downloadUrls = await generateDownloadLinksObject(link);
                }

                // normal versions
                else {
                    const link = generateOtherDownloadLink(
                        versionCode,
                        currentRelease.name
                    );

                    downloadUrls = await generateDownloadLinksObject(link);
                }

                return { ...currentRelease, ...downloadUrls };
            }
        ));
        currentReleases.sort((a, b) => {
            return a.version - b.version
        });
        const index = currentReleases.length - 1;
        if (!currentReleases[index].notes) {
            currentReleases.push({
                name: `${currentReleases[index].name}+`,
                releaseDate: "Latest Release",
                version: currentReleases[index].version,
                zip: currentReleases[index].zip,
                tgz: currentReleases[index].tgz,
            })
        }
        return { ...currentVersion, releases: currentReleases };
    }));

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
        requirementData[allEnvData[envDataIndex]["version"][0]] =
            createRequirementsObject(allEnvData[envDataIndex]);
        ++envDataIndex;
    }

    // iterate over the LTS version data to append the environment requirement data
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
        const environmentXML = await readFile("./environment/environment.xml");

        // Read the content of versions.json which
        const versionsData = JSON.parse(
            await readFile("moodleVersions.json", "utf-8")
        );

        // Parse the XML data using the xml2js module
        parseString(environmentXML, { mergeAttrs: true }, (err, result) => {
            if (err) {
                throw err;
            }

            const envData = JSON.parse(JSON.stringify(result));

            mergeData(versionsData, envData);
        });
    } catch (err) {
        console.log(err);
    }
}

// call main function to perform operation
main();
