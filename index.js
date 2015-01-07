'use strict'

var Class			= require('class')
  , fs				= require('fs')
  , coroutine		= require('coroutine')
  , util			= require('util')

var opt = { persistent: true, recursive: false }
var re_wc = /\.([^\.]+)$/

var Path = Class.inherit({

	onCreate: function(path) {
		this.path = path
		this.dirs = { }
		this.files = { }
	},

	getChanges: function() {
		var changes = []
		this._getChanges(this, changes)
		return changes
	},

	_getChanges: function(item, changes) {

		for(var n in item.files) {
			var f = item.files[n], e = null
			if(f.deleted) {
				e = 'deleteFile'
			}
			else if(f.isNew) {
				e = 'newFile'
			}
			else if(f.isModify) {
				e = 'modifyFile'
			}

			if(null !== e) {
				var s = item.path + '/' + n
				s = s.substr(-1 * (s.length - this.path.length))
				var c = {
					event: e,
					// path: this.path,
					relative: s,
					name: n,
					mtime: f.mtime
				}, a
				if(a = re_wc.exec(s)) {
					c.wc = a[1]
				}
				changes.push(c)
			}			
		}

		for(var n in item.dirs) {
			var d = item.dirs[n]
			this._getChanges(d, changes)
		}
	},
	
	free: function(item) {

		if(item.watch) {
			item.watch.close()
			delete item.watch
		}

		for(var n in item.dirs) {
			var d = item.dirs[n]
			this.free(d)
		}

	},

	cleanup: function() {
		this._cleanup(this)
	},

	_cleanup: function(item) {

	    if(item.isNew) delete item.isNew

		for(var n in item.files) {
			var f = item.files[n]
			if(f.deleted) {
				delete item.files[n]
			}
			else {
				if(f.isNew) delete f.isNew
				if(f.isModify) delete f.isModify
			}
		}

		if(item.deleted) {
			this.free(item)
		}
		else {
			for(var n in item.dirs) {
				var d = item.dirs[n]
				if(d.deleted) {
					this.free(d)
					delete item.dirs[n]
				}
				else {
					this._cleanup(d)
				}
			}
		}
	},

	onFileWatch: function(item, event, filename) {
		this.gen_onFileWatch(this, item, event, filename, function(err, result) { if (err) console.showError(err) })
	},

	gen_onFileWatch: coroutine(function*(path, item, event, filename, g) {

	    var p = item.path + '/' + filename
		var exists = (yield fs.exists(p, g.resumeWithError))[0]
		if(exists) {
			var stat = yield fs.stat(p, g.resume)
			// check for new or modify
			if(stat.isDirectory()) {

				var ctime = stat.ctime.getTime()

				var dirs = [ ]

				if(filename in item.dirs) {
				    console.log('existsing dir ' + filename)
					var d = item.dirs[filename]

					if(d.ctime < ctime) {
						d.ctime = ctime
					}

				}
				else {
					var a = item.dirs[filename] = {
						path:	p,
						dirs:	{},
						files:	{},
						isNew:	true
					}

					path.gen_scan(path, a, g.resume)
				}
			}
			else {
				var mtime = stat.mtime.getTime()
				if(filename in item.files) {
					// check for modify
					var f = item.files[filename]
					if(f.deleted) delete f.deleted

					// if(!f.isModify && !f.isNew && mtime > f.mtime) {
					if(mtime > f.mtime) {
						f.mtime = mtime
						f.isModify = true
					}
				}
				else {
					// new
					item.files[filename] = { isNew: true, mtime: mtime }
				}
			}
		}
		else {
			// check for deleting
			if(filename in item.files) {
				var f = item.files[filename]
				if(!f.deleted) {
					f.deleted = true
			    }
			}
			else if (filename in item.dirs) {
				var d = item.dirs[filename]
				path.markDeleted(d)
			}
		}
	
	}),

	markDeleted: function(item) {
		if(!item.deleted) {
			item.deleted = true
			if(item.watch) {
				item.watch.close()
				delete item.watch
			}
			for(var name in item.dirs) {
				this.markDeleted(item.dirs[name])
			}
		}
	},

	gen_scan: coroutine(function*(path, item, g) {

		var from = item.path
		var dirs = [ [ from, item ] ]

		while(dirs.length) {

			var i = dirs.shift(), dir = i[0], root = i[1]

			root.watch = fs.watch(dir, opt, path.onFileWatch.bind(path, root))

			var files = yield fs.readdir(dir, g.resume)
			for(var i = 0, l = files.length; i < l; i++) {
			    
			    var name = files[i]
				if(name[0] === '.') continue

				var file = dir + '/' + files[i]
				var stat = yield fs.stat(file, g.resume)
				if(stat.isDirectory()) {
					var a = root.dirs[name] = {
						path:	file,
						ctime:	stat.ctime.getTime(),
						dirs:	{},
						files:	{},
						isNew:	true
					}
					dirs.push([ file, a])
				}
				else {
					root.files[name] = { mtime: stat.mtime.getTime(), isNew: true }
				}
					
			}
		}

		return path
	}),

	fileInfo: function(filename) {

		filename = filename.substr(this.path.length)

		var root = this
		var a = filename.substr(1).split('/')
		for(var i = 0, l = a.length - 1; i < l; i++) {
			if(root.deleted) return { exists: false }
			var name = a[i]
			if(name in root.dirs) {
				root = root.dirs[name]
			}
			else {
				return { exists: false }
			}
		}
		var name = a[l]
		if(name in root.files) {
			var file = root.files[name]
			if(file.deleted) return { exists: false }
			return { exists: true, mtime: file.mtime }
		}
		return { exists: false }
	}
})

module.exports = {
	createPath: function(path, callback) {
		var p = Path.create(path)
		p.gen_scan(p, p, callback)
	}
}