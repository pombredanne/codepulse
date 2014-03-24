/*
 * Code Pulse: A real-time code coverage testing tool. For more information
 * see http://code-pulse.com
 *
 * Copyright (C) 2014 Applied Visions - http://securedecisions.avi.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

;(function(exports){

	exports.PackageController = PackageController

	function PackageController(treeData, $container, $totalsContainer, $clearSelectionButton){

		// build this into a Map[packageId -> packageWidget.selectedProp]
		var stateTemplate = {}

		// build this into a Map[packageId -> packageWidget.collapsingProp]
		var collapsingTemplate = {}

		var widgets = {}

		// initialize the `stateTemplate` and `widgets` maps
		// based on the package nodes in `treeData`
		;(function setupTreeHierarchy(packageParentNode, node){
			if(node.kind == 'package' || node.kind == 'root'){

				var pw = new PackageWidget()
				widgets[node.id] = pw

				stateTemplate[node.id] = pw.selectedProp
				pw.selectionClicks.onValue(function(){
					handleSelectionClick(node, pw)
				})

				collapsingTemplate[node.id] = pw.collapsingProp

				// pw.selectedProp.log('selected ' + node.id)

				pw.uiParts.collapser.click(function(event){
					pw.collapseChildren('toggle')
					event.stopPropagation()
				})

				if(node.kind == 'root'){
					pw.uiParts.main.appendTo($totalsContainer)
					pw.abbreviatedLabel('Overall Coverage')
					pw.selectable(false)
				}

				if(node.kind == 'package'){
					if(packageParentNode){
						widgets[packageParentNode.id].children.add(pw)
					} else {
						pw.uiParts.main.appendTo($container)
					}

					if(node.isSelfNode){
						pw.fullLabel(node.name).abbreviatedLabel(node.name)
					} else {
						var parentName = packageParentNode ? packageParentNode.name : '',
							abbrevName = node.name.substr(parentName.length)

						pw.fullLabel(node.name).abbreviatedLabel(abbrevName)
					}
				}
			}

			;(node.children || []).forEach(function(kid){
				var nextParent = (node.kind == 'package')? node : packageParentNode
				setupTreeHierarchy(nextParent, kid)
			})

		})(undefined, treeData.root)

		function hasPackageChild(node){
			var found = false
			;(node.children || []).forEach(function(child){
				if(child.kind == 'package') found = true
			})
			return found
		}

		function handleSelectionClick(node, widget){
			// selected may be one of [1, 0, undefined].
			// transition [1 -> 0], [0 -> 1], [undefined -> 1]
			var newSel = +!widget.selected()

			// apply the new selection to this node and each of its children
			;(function bubbleDown(w){
				w.selected(newSel)
				w.children.forEach(bubbleDown)
			})(widget)

			// climb the tree, re-checking the full/partial selection state of node's ancestors
			;(function bubbleUp(n){
				if(!n || n.kind == 'root') return
				var w = widgets[n.id]
				if(!w) return

				var isFullSelected = true,
					isPartialSelected = false

				w.children.forEach(function(c){
					var s = c.selected()
					if(!s) isFullSelected = false
					if(s == 1 || s == undefined) isPartialSelected = true
				})

				var s = isFullSelected ? 1 : isPartialSelected ? undefined : 0
				w.selected(s)

				bubbleUp(n.parent)

			})(node.parent)
			var p = node.parent, pw = p && widgets[p.id]
		}

		// set the `methodCount` property for all widgets
		applyMethodCounts(treeData, widgets)

		/**
		 * Exposes the selection state of each of the widgets, as a
		 * Map[package.id -> isSelected]
		 */
		this.selectedWidgets = Bacon.combineTemplate(stateTemplate).debounce(10)

		// Decide whether or not to show the "clear all selections" button
		// depending on whether or not there are selected widgets
		this.selectedWidgets
			.map(function(selectionMap){
				for(var k in selectionMap) if(selectionMap[k]) return true
			})
			.not()
			.assign($clearSelectionButton, 'toggleClass', 'hidden')

		// Set all (selectable) widgets to not be selected when the clear selection button is clicked
		$clearSelectionButton.click(function(){
			for(var k in widgets){
				var w = widgets[k]
				if(w.selectable()) w.selected(false)
			}
		})

		/**
		 * Pushes a `1` event when the package widgets' collapse/expand
		 * animation finishes. Used to update affix things since the
		 * animation affects the page height.
		 */
		this.widgetsAnimating = Bacon
			.combineTemplate(collapsingTemplate)
			.map(function(o){
				for(var k in o) if(o[k]) return true
				return false
			})
			.skipDuplicates()
			.toProperty(false)
			.slidingWindow(2)
			.filter(function(a){
				// accepted as the 'animating' prop goes from true to false
				if(a.length == 2 && a[0] === true && a[1] === false) return true
				return false
			})
			.map(function(){ return 1 })

		for(k in widgets) widgets[k].collapseChildren(true)

		/**
		 * Getter / Setter for "compact" mode, which causes the
		 * widgets to take on a compact look.
		 *
		 * controller.compactMode() - returns the current flag
		 * controller.compactMode(b) - sets the current flag to `b`
		 */
		var _compactMode = false
		this.compactMode = function(){
			if(arguments.length){
				_compactMode = arguments[0]
				$container.toggleClass('compact', _compactMode)
				return this
			} else {
				return _compactMode
			}
		}

		this.highlightPackages = function(methodIds){
			highlightPackages(treeData, widgets, methodIds)
		}

		this.applyMethodCoverage = function(coverageRecords){
			applyMethodCoverage(treeData, widgets, coverageRecords)
		}
	}

	// Returns an array of package-kind Tree Nodes.
	function findPackages(treeData){
		var a = []
		a.push(treeData.root)
		treeData.forEachNode(function(node){
			if(node.kind == 'package'){
				a.push(node)
			}
		})
		return a
	}

	// Compute and set the `methodCount` property for all of the widgets
	function applyMethodCounts(treeData, widgets){
		function recurse(node){
			var count = 0

			if(node.kind == 'method') count += 1

			;(node.children || []).forEach(function(kid){
				count += recurse(kid)
			})

			if(widgets[node.id]) widgets[node.id].methodCount(count)

			return count

			/* Alternate Strategy:
			 * Only count methods that fall directly beneath each package;
			 * This means that 'com.foo' would not include methods defined in
			 * 'com.foo.bar'. To do this, uncomment the following, and comment
			 * out the above return statement.
			 */
			/*
			 if(node.kind == 'package') return 0
			 else return count
			 */
		}
		recurse(treeData.root)
	}

	// Trigger a `flashHighlight` on the appropriate package widgets
	// 
	// @param treeData - the tree structure being managed
	// @param widgets - a Map[packageNode.id -> PackageWidget]
	// @param methodIds - an Array[method.id]
	function highlightPackages(treeData, widgets, methodIds){
		var toHighlight = {}


		function bubbleUp(n){
			if(!n) return

			if(widgets[n.id]) toHighlight[n.id] = 1

			/* Alternate Strategy:
			 * Only count methods that fall directly beneath each package;
			 * to do so, uncomment the following:
			 */
			// if(n.packageWidget) return

			bubbleUp(n.parent)
		}

		methodIds.forEach(function(id){
			bubbleUp(treeData.getNode(id))
		})

		for(var id in toHighlight){
			widgets[id].flashHighlight()
		}
	}

	/**
	 * Calculate and apply the method coverage counts for each of
	 * the PackageWidgets, based on the given `coverageRecords`.
	 *
	 * @param treeData - the tree structure being managed
	 * @param widgets - a Map[packageNode.id -> PackageWidget]
	 * @param coverageRecords - An object expected to be in the form:
	 *   as a Map[method.id -> Array[recording.id]], where `recording`
	 *   is from the trace recording controls, and its presence in the
	 *   array means that particular recording encountered the respective
	 *   method.

	*/
	function applyMethodCoverage(treeData, widgets, coverageRecords){
		function computeAndApplyCoverage(node){
			var coverage = 0

			// if there was a record for the current node, count that as 1 coverage point
			if(coverageRecords[node.id] && coverageRecords[node.id].length){
				coverage += 1
			}

			// also include the sum of the childrens' coverages (recursive)
			(node.children || []).forEach(function(kid){
				coverage += computeAndApplyCoverage(kid)
			})

			// apply the `coverage` to the `totalCoverage` property
			if(widgets[node.id]) widgets[node.id].totalCoverage(coverage)

			// return the `coverage` for recursion's sake
			return coverage
		}

		computeAndApplyCoverage(treeData.root)
	}
	

})(this);