#! /usr/bin/env node

// Image processing: https://github.com/EyalAr/lwip

console.log('Starting update_ics_portfolios');
const request = require('request');
const fs = require('fs');
const _ = require('underscore');
const jsonfile = require('jsonfile');
const jsonic = require('jsonic');
const cheerio = require('cheerio');
const async = require('async');

const dataFile = '_data/data.json';
const hallOfFrameURLFile = '_data/Hall-Of-Frame.json'

/** Location of the profile entries file. */
const profileEntriesFile = 'profile-entries.json';

const hallOfFrameCardsFile = '_includes/hallOfFrameCards.html';



/** Holds the profile data, initialized with profile-entries, then updated with bio.json. */
const profileData = [];


/**
 * Initializes profileData with the contents of the profile-entries file.
 */
function initializeProfileData() {
  const contents = fs.readFileSync(profileEntriesFile, 'utf8');
  const data = jsonic(contents);
  _.each(data, function (entry) {
    profileData.push(entry);
  });
}


/**
 * Given a techfolio hostname, returns the URL to its associated bio.json file.
 * @param techfolioHostName A domain, such as 'philipmjohnson.github.io'.
 * @returns {string} The corresponding URL to the bio.json file.
 */
function getBioJsonUrl(techfolioHostName) {
  // URL: https://raw.githubusercontent.com/philipmjohnson/philipmjohnson.github.io/master/_data/bio.json
  const username = techfolioHostName.split('.')[0];
  return `https://raw.githubusercontent.com/${username}/${techfolioHostName}/master/_data/bio.json`;
}

/**
 * Returns a Promise which, when resolved, results in pushing the bio.json onto bioJsons.
 * If an error occurs, prints out a message to the console with the problematic URL.
 * @param url The URL to get the body of.
 * @returns {Promise} A Promise to push that body onto bioJsons.
 */
function getBioFiles(domain) {
  return new Promise(function (resolve) {
    request.get(getBioJsonUrl(domain), function processUrl(error, response, body) {
      if (!error && response.statusCode === 200) {
        try {
          resolve(jsonic(body));
        } catch (e) {
          console.log(`Error: https://${domain}/_data/bio.json\n    ${e.name} ${e.message}, line: ${e.lineNumber}`);
          // reject(new Error(`Failed to parse bio.json for ${domain}.`));
          resolve({});
        }
      } else {
        console.log(`Failed to get bio.json for ${domain}.`);
        // reject(new Error(`Failed to get bio.json for ${domain}.`));
        resolve({});
      }
    });
  });
}

function canonicalHostName(name) {
  'use strict';
  let canonicalName = name.toLowerCase();
  //  canonicalName.replace(/\/$/, ''); // why this doesn't work in the case of pexzabe is beyond me.
  if (canonicalName.slice(-1) === '/') {
    canonicalName = canonicalName.slice(0, -1);
  }
  if (!canonicalName.startsWith('http')) {
    canonicalName = `https://${canonicalName}`;
  }
  return canonicalName;
}

function fixPicturePrefix(pictureUrl) {
  return (pictureUrl.startsWith('http')) ? pictureUrl : `https://${pictureUrl}`;
}

function updateProfileEntry(bio) {
  if (!_.isEmpty(bio)) {
    // first, strip off the protocol part of the website entry.
    const bioUrl = bio.basics.website;
    const protocolIndex = _.indexOf(bioUrl, ':');
    const bioHostName = bioUrl.substring(protocolIndex + 3);
    const profileEntry = _.find(profileData, function makeEntry(entry) {
      //console.log(`${canonicalHostName(entry.techfolio)}, ${canonicalHostName(entry.techfolio).length}, ${canonicalHostName(bioHostName)}, ${canonicalHostName(bioHostName).length}`);
      return canonicalHostName(entry.techfolio) === canonicalHostName(bioHostName);
    });
    if (profileEntry) {
      _.defaults(profileEntry, {
        name: bio.basics.name,
        label: bio.basics.label,
        website: canonicalHostName(bio.basics.website),
        summary: bio.basics.summary,
        picture: fixPicturePrefix(bio.basics.picture),
        interests: _.map(bio.interests, (interest) => interest.name),
      });
      // strip any trailing slash on website url
      profileEntry.website.replace(/\/$/, '');

    } else {
      console.log(`Could not find profile entry corresponding to ${bioHostName} (${bio.basics.name})`);
    }
  }
}

/* Returns the profile entry object whose techfolio entry matches the website entry in the passed bio object. */
function updateProfileEntries(bios) {
  _.each(bios, updateProfileEntry);
}

/**
 * To simplify Jekyll parsing, write out four files: undergrads.json, grads.json, faculty.json, and all.json.
 * Each file is written in sorted order by the last field.
 * Each field contains: bio.basics.name, bio.basics.picture, bio.basics.website, bio.basics.summary, bio.interests
 */
function writeJekyllInfoFiles() {
  console.log('Writing jekyll info files.');
  jsonfile.spaces = 2;
  jsonfile.writeFile(dataFile, _.sortBy(profileData, 'last'), function (err) {
    if (err) {
      console.error(err);
    }
  });

  generateHallOfFrameTemplate();
}

function updateProfileDataFromLocalBio(localProfiles) {
  _.map(localProfiles, function updateLocal(localProfile) {
    const dirName = localProfile.tmpbio;
    const contents = fs.readFileSync(`_tmpbios/${dirName}/bio.json`, 'utf8');
    const bio = jsonic(contents);
    updateProfileEntry(bio);
  });
}


// ////////////////////  Start the script. ////////////////////////////////////////////

// Set profileData to the contents of the profile entries.
initializeProfileData();

// Create a set of promises for reading in the bio.json files associated with every entry.
// Note that profile-entries cannot yet handle non-Techfolio data.

const localProfileData = _.filter(profileData, (obj) => _.has(obj, 'tmpbio'));

updateProfileDataFromLocalBio(localProfileData);

const cloudProfileData = _.filter(profileData, (obj) => !_.has(obj, 'tmpbio'));
const bioBodyPromises = _.map(cloudProfileData, function (entry) {
  return getBioFiles(entry.techfolio);
});

// Retrieve the bio.json files, add them to the profileData object, then write out a Jekyll file
Promise.all(bioBodyPromises)
    .then(function (bios) {
      updateProfileEntries(bios);
      writeJekyllInfoFiles();
    })
    .catch(console.error);


/* Generate template codes for hall of frame files*/
function generateHallOfFrameTemplate() {  
  const hallOfFrameContents = fs.readFileSync(hallOfFrameURLFile, 'utf8');
  var urls = jsonic(hallOfFrameContents);

  if (urls.length > 0) {
    var tasks = [];
    var essays = [];
    var projects = [];

    for (var i = 0; i < urls.length; i++) {
      if (urls[i].indexOf('/essays/') >= 0) {
        essays.push(urls[i]);
      }
      if (urls[i].indexOf('/projects/') >= 0) {
        projects.push(urls[i]);
      }
    }

    urls = essays.concat(projects);

    tasks.push(
      function(callback) {
        getCardHTML(urls[0], "", callback);
      }
    );

    for (var i = 1; i < urls.length; i++) {
      var j = 1;
      tasks.push(
        function(html, callback) {
          getCardHTML(urls[j], html, callback);
          j++;
        }
      );
    }

    async.waterfall(tasks, function(err, result) {
      if (err) {
        console.log(err);
      }
      fs.writeFile(hallOfFrameCardsFile, result, function(err) {
        console.log("Writing to " + hallOfFrameURLFile);
        if(err) {
          return console.log(err);
        }
      });
    });
  } 
}

/* Get the card's HTML */
function getCardHTML(url, html, callback) {
  console.log("Reading " + url + " for hall of frame");
  var summaryPageURL = url.substring(url.substring(0, url.length - 1), url.lastIndexOf("/") + 1);
  var documentName = url.substring(summaryPageURL.length);
  var baseURL = summaryPageURL.substring(0, summaryPageURL.length - 1);
  baseURL = baseURL.substring(0, baseURL.lastIndexOf("/"));

  request(summaryPageURL, function (error, response, body) {
    'use strict';
    if (!error && response.statusCode == 200) {
      let $ = cheerio.load(body);
      $(".card").each(function(index, card) {
        var cardHTML = $.html($(this));
        if (cardHTML.indexOf(documentName) >= 0) {
          var cardObject = replaceLinksToAbsolutePath($, cardHTML, baseURL);
          callback(null, html + cardObject.html() + '\n');
        }
      });
    }
  });
}

/* Replace card's href and src to absolute paths*/
function replaceLinksToAbsolutePath($, cardHTML, baseURL) {
  var cardObject = $('<div>' + cardHTML + '</div>');
  cardObject.find('a').each(function() {
    var href = $(this).attr('href');
    $(this).attr('href', toAbsoluteURL(href, baseURL));
    $(this).attr('target', '_blank');
  });

  cardObject.find('img').each(function() {
    var href = $(this).attr('src');
    $(this).attr('src', toAbsoluteURL(href, baseURL));
  });  

  return cardObject;
}

/* convert relative url to absolute url */
function toAbsoluteURL(relativeURL, base) {
  if (relativeURL.indexOf("http") < 0) {
    if (!base.endsWith("/")) {
      base += "/";
    }
    if (relativeURL.startsWith("/")) {
      relativeURL = relativeURL.substring(1);
    }
    return base + relativeURL;
  } else {
    return relativeURL;
  }

}



String.prototype.format = function() {
    var formatted = this;
    for(arg in arguments) {
        formatted = formatted.replace("{" + arg + "}", arguments[arg]);
    }
    return formatted;
};



