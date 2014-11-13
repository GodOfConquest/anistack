'use strict';

var db = require('../../models/db.js');
var mongoose = require('mongoose');
var hAuth = require('../../helpers/auth.js');
var Anime = db.Anime;
var User = db.User;
var Manga = db.Manga;
var _ = require('lodash');

module.exports = function(app) {
	var Collection;

	// Sets the collection type
	app.route('/:collection(anime|manga)*')
	.all(function(req, res, next) {
		if (req.param('collection') === 'anime') {
			Collection = Anime;
		} else {
			Collection = Manga;
		}
		next();
	});

	// Get all anime/manga
	app.route('/:collection(anime|manga)/all')
	.all(hAuth.ifStaff)
	.get(function(req, res, next) {
		Collection.find({}, function(err, docs) {
			if (err) return next(new Error(err));
			res.status(200).json({ series: docs, count: docs.length });
		});
	});

	// Random thing used for testing
	app.route('/:collection(anime|manga)/test')
	.get(function(req, res, next) {

		// List all genres
		Collection.find({}, function(err, docs) {
			if (err) return next(err);
			var docsLen = docs.length;
			var uniqueGenres = [];
			for(var i = 0; i < docsLen; i++){
				uniqueGenres = uniqueGenres.concat(docs[i].series_genres);
			}
			res.status(200).json(_.uniq(uniqueGenres).sort());
		});
	});

	// Get one anime/manga by _id
	app.route('/:collection(anime|manga)/view/:_id')
	.get(function(req, res, next) {
		var searchConditions = {};

		if (req.param('_id').match(/^[0-9a-fA-F]{24}$/)) {
			searchConditions._id = req.param('_id');
		} else {
			searchConditions.series_slug = req.param('_id');
		}

		Collection.findOne(searchConditions, function(err, seriesDoc) {
			if (err) return next(new Error(err));
			if (!seriesDoc) return next(new Error('series not found'));

			seriesDoc = seriesDoc.toObject();
			
			if (req.user && req.user[req.param('collection') + '_list']) {
				seriesDoc.item_data = _.find(req.user[req.param('collection') + '_list'], { _id: seriesDoc._id });
			}
			res.status(200).json(seriesDoc);
		});
	});

	// Get count for each rating number from user lists
	app.route('/:collection(anime|manga)/stats/:_id')
	.get(function(req, res, next) {
		if (!req.param('_id').match(/^[0-9a-fA-F]{24}$/)) return false;

		var statsQuery;

		// Maybe there is a better way of splitting up these queries?
		if (req.param('collection') === 'anime'){
			statsQuery = [{
				$unwind: '$anime_list'
			}, {
				$match: {
					'anime_list._id': mongoose.Types.ObjectId(req.param('_id'))
				}
			}, {
				$project: {
					rating: '$anime_list.item_rating'
				}
			}, {
				$match: {
					rating: {
						$gt: 0
					}
				}
			}, {
				$group: {
					_id: '$rating',
					count: { $sum: 1 }
				}
			}];
		} else {
			statsQuery = [{
				$unwind: '$manga_list'
			}, {
				$match: {
					'manga_list._id': mongoose.Types.ObjectId(req.param('_id'))
				}
			}, {
				$project: {
					rating: '$manga_list.item_rating'
				}
			}, {
				$match: {
					rating: {
						$gt: 0
					}
				}
			}, {
				$group: {
					_id: '$rating',
					count: { $sum: 1 }
				}
			}];
		}

		User.aggregate(statsQuery, function(err, ratingsResult) {
			if (!err) {

				// Add missing ratings
				if (ratingsResult.length < 10) {
					var ratings = _.pluck(ratingsResult, function(rating) {
						return rating._id;
					});
					var missingRatings = _.difference(_.range(1, 11), ratings);

					for (var i = 0; i < missingRatings.length; i++) {
						ratingsResult.push({
							_id: missingRatings[i],
							count: 0
						});
					}
				}

				ratingsResult = _.sortBy(ratingsResult, function(rating) {
					return rating._id
				});

				res.status(200).json([
					{"_id":1,"count":5},
					{"_id":2,"count":15},
					{"_id":3,"count":35},
					{"_id":4,"count":55},
					{"_id":5,"count":88},
					{"_id":6,"count":95},
					{"_id":7,"count":75},
					{"_id":8,"count":55},
					{"_id":9,"count":56},
					{"_id":10,"count":48}
				]);
			} else {
				next(new Error('could not aggregate ratings'));
			}
		});
	});

	// Find series that share similar genres
	app.route('/:collection(anime|manga)/similar/:_id')
	.get(function(req, res, next) {
		if (!req.param('_id').match(/^[0-9a-fA-F]{24}$/)) return false;
		Collection.findOne({
			_id: req.param('_id')
		}, function(err, seriesDoc) {
			if (err || !seriesDoc) return next(new Error(err));
			Collection.find({
				_id: { $ne: seriesDoc._id },
				series_type: seriesDoc.series_type, // Same series type
				series_date_start: { $gte: new Date('2006') }, // People prefer newer series
				series_date_end: { $lte: new Date('2014') }, // People prefer newer series
				series_genres: { $in: seriesDoc.series_genres }
			}).sort({
				series_date_start: -1
			}).limit(1000).exec(function(err, seriesSimilar) {

				// Sort by number of matching genres
				seriesSimilar = _.sortBy(seriesSimilar, function(series) {
					if (!series.series_genres) return -1;
					var intersectionLen = _.intersection(seriesDoc.series_genres, series.series_genres).length;
					return intersectionLen * 1 / (intersectionLen - series.series_genres.length + 1);
				});
				res.status(200).json(seriesSimilar.slice(0, 5));
			});
		});
	});

	// Search for anime/manga, returns max 15 results, sorted by date in desc order
	app.route('/:collection(anime|manga)/search/:query')
	.get(function(req, res, next) {
		if (!req.param('query')) return res.status(200).json([]);
		var searchQuery = req.param('query');
		var dbSearchQuery = new RegExp(searchQuery, 'gi');

		Collection.find(
			{ $or: [
				{ $text: { $search: searchQuery, $language: 'none' }},
				{ series_title_main: dbSearchQuery },
				{ series_title_english: dbSearchQuery }
			]},
			{ score: { $meta: 'textScore' }}
		)
		.sort({ score: { $meta: 'textScore' }})
		.limit(15)
		.exec(function(err, docs) {
			if (err) return next(new Error(err));
			var sortedDocs = _.sortBy(docs, function(series) {

				// Hacky sort function
				return ['movie', 'tv', 'manga'].indexOf(series.series_type) * -1;
			});

			sortedDocs = sortedDocs.map(function(series) {
				return series.toObject();
			});

			if (req.user && req.user[req.param('collection') + '_list']) {
				for(var i = 0; i < sortedDocs.length; i++){
					var findRes = _.find(req.user[req.param('collection') + '_list'], {
						_id: sortedDocs[i]._id
					});
					if (findRes){
						sortedDocs[i].item_data = findRes;
					}
				}
			}
			res.status(200).json(sortedDocs).end();
		});
	});
}