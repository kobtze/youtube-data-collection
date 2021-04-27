"use strict";

const express = require("express");
const app = express();
const axios = require("axios");
const credentials = require("./credentials");

app.listen(8080);

app.get("/", function (req, res) {
  const { videoId, maxResults } = req.query;
  if (!videoId || !maxResults) {
    res.status(400).send({
      message: "videoId / maxResults empty!",
    });
    return;
  }
  getCommentsTree(videoId, +maxResults)
    .then((data) => {
      res.send(data);
    })
    .catch((err) => {
      res.status(500).send({
        message: err.message || "Some error occured while fetching",
      });
    });
});

let externalApiCallCount = 0;

async function getCommentsTree(videoId, maxResults = 20) {
  // 1. Create empty array
  let rawComments = [];
  let amountGot = 0;
  let amountNeeded = maxResults;
  let threadsNextPageToken = "";
  let threadsWithMoreThen5Replies = 0;
  // 2. While loop (collect threads)
  do {
    let commentThreads = await _getCommentThreads(
      videoId,
      amountNeeded < 100 ? amountNeeded : 100,
      threadsNextPageToken
    );
    threadsNextPageToken = commentThreads.nextPageToken
      ? commentThreads.nextPageToken
      : "";
    amountGot += _countComments(commentThreads.items); // Check 2nd and later occurances
    amountNeeded = maxResults - amountGot;
    try {
      // 3. While loop (collect comments)
      // if (amountNeeded > 0) { // Add this later on
      await commentThreads.items.forEach(async (el) => {
        // Iterate over threads
        if (amountNeeded > 0 && el.snippet && el.snippet.totalReplyCount > 5) {
          threadsWithMoreThen5Replies++;
          let commentsNextPageToken = "";
          // console.log(el.replies.comments.length, ' comments before: ', el.replies.comments)
          do {
            let comments = await _getComments(
              el.id,
              amountNeeded < 100 ? amountNeeded : 100,
              commentsNextPageToken
              );
              // Insert replies into thread
              el.replies = new Object({ comments: comments.items });
              // console.log(el.replies.comments.length, ' comments after: ', el.replies.comments)
              commentsNextPageToken = comments.nextPageToken
              ? comments.nextPageToken
              : "";
              amountGot += _countComments(comments.items) - 5;
            amountNeeded = maxResults - amountGot;
          } while (amountNeeded > 0 && commentsNextPageToken);
        }
      });
    } catch (err) {
      console.log(err);
    }
    // }
    rawComments.push(...commentThreads.items);
  } while (amountNeeded > 0 && threadsNextPageToken);
  // 4. Return formatted Comments Obj
  const output = new Comments(videoId, rawComments);
  console.log("threadsWithMoreThen5Replies: ", threadsWithMoreThen5Replies);
  console.log("amountGot: ", amountGot);
  return output;
}

function Comments(videoId, items) {
  this.metadata = {
    kind: "comments",
    videoId,
    totalThreads: items.length,
    totalCount: _countComments(items),
  };
  this.comments = items.map((el) => {
    return new Object({
      id: el.id,
      text: el.snippet.topLevelComment.snippet.textDisplay,
      replies: el.replies
        ? el.replies.comments.map((innerEl) => {
            return new Object({
              id: innerEl.id,
              text: innerEl.snippet.textDisplay,
            });
          })
        : undefined,
    });
  });
}

async function _getCommentThreads(videoId, maxResults, pageToken) {
  const pageTokenParam = pageToken ? `pageToken=${pageToken}` : "";
  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/commentThreads?" +
        `videoId=${videoId}&` +
        `maxResults=${maxResults}&` +
        // `part=snippet&` +
        `part=snippet,replies&` + // => Significantly lower requests volume
        `order=relevance&` +
        `key=${credentials.API_KEY}&` +
        pageTokenParam
    );
    externalApiCallCount++;
    console.log(
      "apiCalls: ",
      externalApiCallCount,
      "   videoId: ",
      videoId,
      "   maxResults: ",
      maxResults,
      "   returnedCount: ",
      res.data.items.length,
      // "   amountNeeded: ",
      // amountNeeded,
      // "   amountGot: ",
      // amountGot
    );
    return res.data;
  } catch (err) {
    console.log(err);
  }
}

async function _getComments(parentId, maxResults, pageToken) {
  const pageTokenParam = pageToken ? `pageToken=${pageToken}` : "";
  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/comments?" +
        `parentId=${parentId}&` +
        `maxResults=${maxResults}&` +
        `part=snippet&` +
        // + `part=snippet,replies&`
        `key=${credentials.API_KEY}&` +
        pageTokenParam
    );
    externalApiCallCount++;
    console.log(
      "apiCalls: ",
      externalApiCallCount,
      "   parentId: ",
      parentId,
      "   maxResults: ",
      maxResults,
      "   returnedCount: ",
      res.data.items.length,
      // "   amountNeeded: ",
      // amountNeeded,
      // "   amountGot: ",
      // amountGot
    );
    return res.data;
  } catch (err) {
    console.log(err);
  }
}

function _countComments(itemsArray) {
  const reducer = (accumulator, currentValue) => accumulator + currentValue;
  // Map replies for each thread => array of numbers
  const replyMap = itemsArray.map((el) =>
    el.snippet.totalReplyCount > 0 && el.replies
      ? el.replies.comments.length
      : 0
  );
  // Reduce the map, use threads length as initialValue
  return replyMap.reduce(reducer, replyMap.length);
}
