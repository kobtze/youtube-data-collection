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

async function getCommentsTree(videoId, maxResults = 20) {
  // 1. Create empty array
  let rawComments = [];
  // 2. While loop (collect threads)
  let amountGot = 0;
  let amountNeeded = maxResults;
  let threadsNextPageToken = "";
  do {
    let commentThreads = await _getCommentThreads(
      videoId,
      amountNeeded < 100 ? amountNeeded : 100,
      threadsNextPageToken
    );
    threadsNextPageToken = commentThreads.nextPageToken
      ? commentThreads.nextPageToken
      : "";
    amountGot += _countComments(commentThreads.items);
    amountNeeded = maxResults - amountGot;
    try {
      // 3. While loop (collect comments)
      await commentThreads.items.forEach(async (el) => {
        if (amountNeeded > 0 && el.snippet && el.snippet.totalReplyCount > 5) {
          let commentsNextPageToken = "";
          do {
            let comments = await _getComments(
              el.id,
              amountNeeded < 100 ? amountNeeded : 100,
              commentsNextPageToken
            );
            // Insert replies into thread (Todo: support threads > 100)
            el.replies = new Object({ comments: comments.items });
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
    // Insert threads into array
    rawComments.push(...commentThreads.items);
  } while (amountNeeded > 0 && threadsNextPageToken);
  // 4. Return formatted Comments Obj
  const output = new Comments(videoId, rawComments);
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
