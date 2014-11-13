'use strict';

var db = require('../../models/db.js');
var Anime = db.Anime;
var Manga = db.Manga;

module.exports = function(app) {
	var Collection;

	app.route('/:collection(anime|manga)*')
	.all(function(req, res, next) {
		if (req.param('collection') === 'anime') {
			Collection = Anime;
		} else {
			Collection = Manga;
		}
		next();
	});

	app.route('/:collection(anime|manga)/:slug')
	.get(function(req, res, next) {
		Collection.findOne({
			series_slug: req.param('slug')
		}, function(err, seriesDoc) {
			if (err || !seriesDoc) {
				next();
			} else {
				seriesDoc = seriesDoc.toObject();
				seriesDoc.series_synopsis = (seriesDoc.series_synopsis) ? seriesDoc.series_synopsis.replace('\r\n', '\n').split('\n') : '';

				res.render((seriesDoc.series_image_cover) ? 'series' : 'series-no-cover', {
					title: seriesDoc.series_title_main,
					collection: req.param('collection'),
					series: seriesDoc
				});
			}
		});
	});
}