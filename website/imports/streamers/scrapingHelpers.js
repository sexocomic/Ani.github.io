import {Shows} from "../api/shows/shows";
import moment from 'moment-timezone';

export default class ScrapingHelpers {
  static replaceDescriptionCutoff(description, oldCutoff) {
    return description.replaceEnd(oldCutoff, Shows.descriptionCutoff);
  }

  static buildAiringDate(timezone, build) {
    let airingDateResult = {};
    let airingDateMoment = moment.tz(timezone);

    build(airingDateResult, airingDateMoment);

    if (airingDateResult.hour) {
      airingDateMoment.tz('UTC');
    }

    Object.keys(airingDateResult).forEach((key) => {
      if (airingDateResult[key]) {
        airingDateResult[key] = airingDateMoment.get(key);
      }
    });

    return airingDateResult;
  }

  static determineEarliestAiringDate(dateA, dateB) {
    if (Object.countNonEmptyValues(dateA) > Object.countNonEmptyValues(dateB)) {
      let temp = dateB;
      dateB = dateA;
      dateA = temp;
    }

    if (dateA.year < dateB.year || (dateA.year === dateB.year
        && (dateA.month < dateB.month || (dateA.month === dateB.month
          && (dateA.date < dateB.date || (dateA.date === dateB.date
            && (dateA.hour < dateB.hour || (dateA.hour === dateB.hour
              && dateA.minute < dateB.minute)))))))) {
      return dateA;
    }

    return dateB;
  }

  static buildAiringDateFromStandardStrings(timezone, index, stringDates, stringSeason, stringDay, stringTime) {
    if (!timezone) {
      timezone = 'UTC';
    }

    return ScrapingHelpers.buildAiringDate(timezone, (airingDateResult, airingDateMoment) => {

      if (stringDates) {
        let stringDatesBits = stringDates.cleanWhitespace().split(' to ');
        if (stringDatesBits[0]) {
          let stringDatesBitsBits = stringDatesBits[stringDatesBits.length === 2 ? index : 0].replace(/,/g, '').split(' ');
          if (stringDatesBitsBits.length >= 1 && !stringDatesBitsBits[stringDatesBitsBits.length - 1].includes('?')) {
            airingDateMoment.year(stringDatesBitsBits[stringDatesBitsBits.length - 1]);
            airingDateResult.year = true;
          }
          if (stringDatesBitsBits.length >= 2 && !stringDatesBitsBits[0].includes('?')) {
            airingDateMoment.month(stringDatesBitsBits[0]);
            airingDateResult.month = true;
          }
          if (stringDatesBitsBits.length >= 3 && !stringDatesBitsBits[1].includes('?')) {
            airingDateMoment.date(stringDatesBitsBits[1]);
            airingDateResult.date = true;
          }
        }
      }

      if (stringSeason && index === 0) {
        let stringSeasonBits = stringSeason.cleanWhitespace().split(' ');
        if (stringSeasonBits.length === 2) {
          if (!airingDateResult.year) {
            airingDateMoment.year(stringSeasonBits[1]);
            airingDateResult.year = true;
          }
          if (!airingDateResult.month) {
            airingDateMoment.quarter(Shows.validQuarters.indexOf(stringSeasonBits[0]) + 1);
            airingDateResult.month = true;
          }
        }
      }

      if (stringDay && !airingDateResult.date && airingDateResult.month && airingDateResult.year) {
        airingDateMoment.day(stringDay);
        airingDateResult.date = true;
      }

      if (stringTime && airingDateResult.date && airingDateResult.month && airingDateResult.year) {
        airingDateMoment.hour(stringTime.split(':')[0]);
        airingDateResult.hour = true;
        airingDateMoment.minute(stringTime.split(':')[1]);
        airingDateResult.minute = true;
      }

    });
  }

  static prepareAltForMatching(altName) {
    // allow matching of 'and', 'to' and 'und' to each other
    // allow matching of '&' to synonymous words
    // allow matching of ': ' to ' '
    let regex = '^' + RegExp.escape(altName).replace(/((?:\\:)? ?)\band\b((?:\\:)? ?)|((?:\\:)? ?)\bund\b((?:\\:)? ?)|((?:\\:)? ?)\bto\b((?:\\:)? ?)|((?:\\:)? ?)&((?:\\:)? ?)/g, '(?:$1$3$5$7 ?and ?$2$4$6$8|$1$3$5$7 ?und ?$2$4$6$8|$1$3$5$7 ?to ?$2$4$6$8|(?:$1$3$5$7)?&(?:$2$4$6$8)?)').replace(/\\: | /g, '(?:\\: | )') + '$';
    // allow case insensitive matching
    return new RegExp(regex, 'i');
  }

  static queryMatchingShows(collection, show, id=undefined) {
    // Validate
    Schemas.Show.validate(show, {
      keys: ['name', 'altNames', 'streamerUrls', 'malId', 'season', 'thumbnails', 'type']
    });

    // Match based on names/altNames, thumbnails, or streamerUrls
    let selector = {
      $or: [{
        $nor: show.streamerUrls.map((streamerUrl) => {
          return {
            streamerUrls: {
              $elemMatch: {
                streamerId: streamerUrl.streamerId,
                type: streamerUrl.type,
                url: {$ne: streamerUrl.url}
              }
            }
          };
        }),
        $or: [{
          name: {
            $in: show.altNames.map((altName) => {
              return this.prepareAltForMatching(altName);
            })
          }
        }, {
          altNames: this.prepareAltForMatching(show.name)
        }]
      // }, {
      //   thumbnails: {
      //     $in: show.thumbnails
      //   }
      // }, {
      //   $or: show.streamerUrls.map((streamerUrl) => {
      //     return {
      //       streamerUrls: {
      //         $elemMatch: {
      //           streamerId: streamerUrl.streamerId,
      //           type: streamerUrl.type,
      //           url: streamerUrl.url
      //         }
      //       }
      //     };
      //   })
      }]
    };

    // Restrict based on season
    if (show.season) {
      selector.$or[0].season = {
        $in: [show.season, undefined]
      }
    }

    // Restrict based on type
    if (show.type) {
      if (show.type === 'TV') {
        selector.$or[0].type = {
          $in: ['TV', undefined]
        }
      } else {
        selector.$or[0].type = {
          $ne: 'TV'
        }
      }
    }

    // Restrict and match based on MAL id
    if (typeof show.malId !== 'undefined') {
      selector.$or[0].malId = {
        $exists: false
      };
      selector.$or.push({
        malId: show.malId
      });
    }

    // Restrict based on supplied id
    if (id) {
      selector._id = id;
    }

    // Return results cursor
    return collection.find(selector);
  }
}
