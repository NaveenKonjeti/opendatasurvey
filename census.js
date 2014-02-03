var fs = require('fs')
  , _ = require('underscore')
  , crypto = require('crypto')
  , passport = require('passport')
  , FacebookStrategy = require('passport-facebook').Strategy

  , config = require('./lib/config')
  , env = require('./env')
  , model = require('./lib/model').OpenDataCensus
  ;


var addRoutes = function (app) {

  app.get('/faq', function(req, res) {
    var tmpl = env.getTemplate('_snippets/questions.html');
    var questionInfo = tmpl.render({
      questions: model.data.questions
    });
    var dataTmpl = env.getTemplate('_snippets/datasets.html');
    var dataInfo = dataTmpl.render({
      datasets: model.data.datasets
    });
    fs.readFile('templates/faq.md', 'utf8', function(err, text) {
      var marked = require('marked');
      var content = marked(text);
      content = content.replace('{{questions}}', questionInfo);
      content = content.replace('{{datasets}}', dataInfo);
      res.render('base.html', {
        content: content,
        title: 'FAQ - Frequently Asked Questions'
      });
    });
  });

  app.get('/contribute', function(req, res) {
    res.render('country/contribute.html', {places: model.data.places});
  });

  app.get('/country/submit', function(req, res) {
    requireLoggedIn(req, res);

    var datasets = [];
    var ynquestions = model.data.questions.slice(0,9);
    var prefill = req.query;
    var year = prefill.year || config.get('submit_year');

    function render(prefill_) {
      res.render('country/submit.html', {
        places: model.data.places,
        ynquestions: ynquestions,
        questions: model.data.questions,
        datasets: model.data.datasets,
        year: year,
        prefill: prefill_
      });
    }

    // look up if there is an entry and if so we use it to prepopulate the form
    if (prefill.dataset && prefill.place) {
      model.backend.getEntry({
        place: prefill.place,
        dataset: prefill.dataset,
        year: year,
      }, function(err, obj) {
        // we allow query args to override entry values
        // might be useful (e.g. if we started having form errors and
        // redirecting here ...)
        if (obj) { // we might have a got a 404 etc
          prefill = _.extend(obj, prefill);
        }
        render(prefill);
      });
    } else {
      render(prefill);
    }
  });

  app.post('/country/submit', function(req, res) {
    requireLoggedIn(req, res);

    model.backend.insertSubmission(req.body, function(err, obj) {
      var msg;
      // TODO: Do flash messages properly
      if (err) {
        console.log(err);
        msg = 'There was an error! ' + err;
        req.flash('error', msg);
      } else {
        msg = 'Thank-you for your submission which has been received. It will now be reviewed by an Editor before being published. It may take up to a few minutes for your submission to appear here and up to a few days for it be reviewed. Please be patient.';
        req.flash('info', msg);
      }
      res.redirect('country/overview/' + req.body['place']);
    });
  });

  app.get('/country/submission/:id', function(req, res) {
    model.backend.getSubmission({submissionid: req.params.id}, function(err, obj) {
      if (err) {
        res.send(500, 'There was an rror: ' + err);
      }
      // TODO: do something properly ...
      res.send('Your submission exists');
    });
  });

  app.get('/country/submission/:id.json', function(req, res) {
    model.backend.getSubmission({submissionid: req.params.id}, function(err, obj) {
      if (err) {
        res.json(500, { error: { message: 'There was an error: ' + err } });
      }
      res.json(obj);
    });
  });

  // Compare & update page
  app.get('/country/review/:submissionid', function(req, res) {
    requireLoggedIn(req, res);

    var ynquestions = model.data.questions.slice(0,9);

    model.backend.getSubmission({submissionid: req.params.submissionid}, function(err, obj) {
      if (err) {
        res.send(500, 'There was an error ' + err);
      } else if (!obj) {
        res.send(404, 'There is no submission with id ' + req.params.submissionid);
      } else {
        // let's see if there was an entry
        model.backend.getEntry(obj, function(err, entry) {
          if (!entry) {
            entry = {};
          }
          var dataset = _.find(model.data.datasets, function(d) {
            return (d.id == obj.dataset);
          });
          res.render('country/review/index.html', {
            info: model.data.country,
            ynquestions: ynquestions,
            subrecord: obj,
            prefill: obj,
            currrecord: entry,
            dataset: dataset
          });
        });
      }
    });
  });

  app.post('/country/review/:submissionid', function(req, res) {
    requireLoggedIn(req, res);

    model.backend.getSubmission({
      submissionid: req.params.submissionid
    }, function(err, submission) {
      if (err) {
        res.send(500, err);
        return;
      } else if (!submission) {
        res.send(404, 'No submission found for that info');
        return;
      } else {
        processSubmission(submission);
      }
    });

    function processSubmission(submission) {
      if ((req.body['submit']) === "Publish") {
        model.backend.acceptSubmission(submission, req.body, function(err) {
          if (err) {
            res.send(500, err);
          } else {
            var msg = "Submission processed and entered into the census.";
            req.flash('info', msg);
            doneUpdating(req, res, submission);
          }
        });
      } else if (req.body['submit'] === "Reject") {
        submission.reviewresult = 'rejected';
        // The only field we need from the form is the reviewer
        submission.reviewer = req.body['reviewername'];
        model.backend.markSubmissionAsReviewed(submission, function(err) {
          var msg = "Submission marked as rejected. The entry has been archived and marked as rejected. It will take a few minutes for this table to update. Thank you!";
          req.flash('info', msg);
          doneUpdating(req, res, submission);
        });
      }
    }
    function doneUpdating(req, res, submission) {
      // Get latest data
      model.load(function() {
        res.redirect('country/overview/' + submission.place);
      });
    }
  });

  //"Log In" page
  app.get('/country/login', function(req, res) {
    res.redirect('/login?next=' + req.query.next);
  });

app.get('/login', function(req, res) {
  // TODO: use this stored next url properly ...
  req.session.nextUrl = req.query.next;
  res.render('login.html', {
  });
});

app.get('/auth/loggedin', function(req, res) {
  if (req.session.nextUrl) {
    res.redirect(req.session.nextUrl);
  } else {
    res.redirect('/');
  }
});

app.get('/auth/facebook',
    passport.authenticate('facebook', {scope: ['email']})
);

app.get('/auth/facebook/callback', 
  passport.authenticate('facebook', {
      successRedirect: '/auth/loggedin',
      failureRedirect: '/login',
      failureFlash: true,
      successFlash: true
    }
  )
);

passport.use(
  new FacebookStrategy({
      clientID: config.get('facebook:app_id'),
      clientSecret: config.get('facebook:app_secret'),
      callbackURL: config.get('site_url') + '/auth/facebook/callback',
      profileFields: ['id', 'displayName', 'name', 'username', 'emails', 'photos']
    },
    function(accessToken, refreshToken, profile, done) {
      var userobj = {
        id: profile.provider + ':' + profile.username,
        provider_id: profile.id,
        provider: profile.provider,
        username: profile.username,
        name: profile.displayName,
        email: profile.emails[0].value,
        given_name: profile.name.givenName,
        family_name: profile.name.familyName,
      };
      var md5sum = crypto.createHash('md5');
      md5sum.update(userobj.email.toLowerCase());
      userobj.gravatar = 'https://www.gravatar.com/avatar/' + md5sum.digest() + '.jpg';
      done(null, userobj);
    }
  )
);

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(profile, done) {
  var err = null;
  done(err, profile);
});

app.get('/auth/logout', function(req, res){
  req.logout();
  res.redirect('/');
});

};

function requireLoggedIn(req, res) {
  if (!req.user) {
    res.redirect('/login/?next=' + encodeURIComponent(req.url));
    return;
  }
};

exports.addRoutes = addRoutes;
